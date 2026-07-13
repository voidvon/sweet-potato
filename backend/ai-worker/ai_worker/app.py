from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json

from ai_worker.config import settings
from ai_worker.domain.errors import ValidationError, WorkerError
from ai_worker.infra.cookie_pool import cookie_pool
from ai_worker.infra import logger
from ai_worker.services.video_inspection_service import VideoInspectionService
from ai_worker.services.vod_upload_service import VodUploadService
from ai_worker.services.vod_enhancement_service import VodEnhancementService
from ai_worker.services.vod_understanding_service import VodUnderstandingService


video_inspection_service = VideoInspectionService()
vod_upload_service = VodUploadService()
vod_enhancement_service = VodEnhancementService()
vod_understanding_service = VodUnderstandingService()


class AiWorkerHandler(BaseHTTPRequestHandler):
    def _read_json(self) -> dict:
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0:
            return {}
        return json.loads(self.rfile.read(length).decode("utf-8") or "{}")

    def _send_json(self, status: int, payload: dict):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            self._send_json(200, {
                "ok": True,
                "service": "python-ai-worker",
                "version": 1,
                "douyinCookiePool": cookie_pool.stats(),
            })
            return
        if self.path == "/vod/credentials":
            payload = vod_upload_service.credentials_diagnostics()
            payload["understanding"] = vod_understanding_service.diagnostics()
            payload["enhancement"] = vod_enhancement_service.diagnostics()
            self._send_json(200, payload)
            return
        if self.path == "/vod/understanding/agents":
            self._send_json(200, vod_understanding_service.agents())
            return
        if self.path.startswith("/vod/upload/progress"):
            upload_id = self.path.split("uploadId=", 1)[1].split("&", 1)[0] if "uploadId=" in self.path else ""
            self._send_json(200, vod_upload_service.upload_progress(upload_id))
            return
        self._send_json(404, {"ok": False, "message": "Not found"})

    def do_POST(self):
        if self.path == "/video/inspect":
            self._handle_video_inspect()
            return
        if self.path == "/vod/upload":
            self._handle_vod_upload()
            return
        if self.path == "/vod/understanding/start":
            self._handle_vod_understanding_start()
            return
        if self.path == "/vod/understanding/get":
            self._handle_vod_understanding_get()
            return
        if self.path == "/vod/enhancement/start":
            self._handle_vod_enhancement_start()
            return
        if self.path == "/vod/enhancement/get":
            self._handle_vod_enhancement_get()
            return
        if self.path == "/generate":
            self._handle_legacy_generate()
            return
        self._send_json(404, {"ok": False, "message": "Not found"})

    def _handle_video_inspect(self):
        trace_id = self.headers.get("X-Trace-Id", "")
        try:
            payload = self._read_json()
            url = str(payload.get("url") or "").strip()
            if not url:
                raise ValidationError("缺少视频 URL")
            logger.info("http video inspect request received", {"traceId": trace_id, "url": url})
            result = video_inspection_service.inspect_url(url, trace_id=trace_id)
            self._send_json(200, result.to_dict())
        except WorkerError as error:
            logger.warning("http video inspect request failed", {"traceId": trace_id, "error": str(error), "statusCode": error.status_code})
            self._send_json(error.status_code, {"ok": False, "message": str(error)})
        except Exception as error:
            logger.error("http video inspect request crashed", {"traceId": trace_id, "error": str(error)})
            self._send_json(500, {"ok": False, "message": str(error) or "AI Worker 内部错误"})

    def _handle_vod_upload(self):
        trace_id = self.headers.get("X-Trace-Id", "")
        try:
            payload = self._read_json()
            file_path = str(payload.get("filePath") or "").strip()
            file_name = str(payload.get("fileName") or "").strip()
            title = str(payload.get("title") or "").strip()
            upload_id = str(payload.get("uploadId") or "").strip()
            if not file_path:
                raise ValidationError("缺少本地视频文件路径")
            if not file_name:
                raise ValidationError("缺少视频文件名")
            logger.info("http vod upload request received", {"traceId": trace_id, "filePath": file_path, "fileName": file_name})
            result = vod_upload_service.upload_local_video(file_path=file_path, file_name=file_name, title=title, upload_id=upload_id or trace_id)
            self._send_json(200, result)
        except WorkerError as error:
            logger.warning("http vod upload request failed", {"traceId": trace_id, "error": str(error), "statusCode": error.status_code})
            self._send_json(error.status_code, {"ok": False, "message": str(error)})
        except Exception as error:
            logger.error("http vod upload request crashed", {"traceId": trace_id, "error": str(error)})
            self._send_json(500, {"ok": False, "message": str(error) or "AI Worker 内部错误"})

    def _handle_vod_understanding_start(self):
        trace_id = self.headers.get("X-Trace-Id", "")
        try:
            payload = self._read_json()
            vid = str(payload.get("vid") or "").strip()
            space_name = str(payload.get("spaceName") or "").strip()
            file_path = str(payload.get("filePath") or "").strip()
            roles = payload.get("roles")
            logger.info("http vod understanding start request received", {
                "traceId": trace_id,
                "vid": vid,
                "spaceName": space_name,
                "hasFilePath": bool(file_path),
                "rolesCount": len(roles) if isinstance(roles, list) else 0,
            })
            result = vod_understanding_service.start(vid=vid, roles=roles, space_name=space_name, file_path=file_path)
            self._send_json(200, result)
        except WorkerError as error:
            logger.warning("http vod understanding start request failed", {"traceId": trace_id, "error": str(error), "statusCode": error.status_code})
            self._send_json(error.status_code, {"ok": False, "message": str(error)})
        except Exception as error:
            logger.error("http vod understanding start request crashed", {"traceId": trace_id, "error": str(error)})
            self._send_json(500, {"ok": False, "message": str(error) or "AI Worker 内部错误"})

    def _handle_vod_understanding_get(self):
        trace_id = self.headers.get("X-Trace-Id", "")
        try:
            payload = self._read_json()
            run_id = str(payload.get("runId") or "").strip()
            logger.info("http vod understanding get request received", {"traceId": trace_id, "runId": run_id})
            result = vod_understanding_service.get_execution(run_id=run_id)
            self._send_json(200, result)
        except WorkerError as error:
            logger.warning("http vod understanding get request failed", {"traceId": trace_id, "error": str(error), "statusCode": error.status_code})
            self._send_json(error.status_code, {"ok": False, "message": str(error)})
        except Exception as error:
            logger.error("http vod understanding get request crashed", {"traceId": trace_id, "error": str(error)})
            self._send_json(500, {"ok": False, "message": str(error) or "AI Worker 内部错误"})

    def _handle_vod_enhancement_start(self):
        trace_id = self.headers.get("X-Trace-Id", "")
        try:
            payload = self._read_json()
            result = vod_enhancement_service.start(
                vid=str(payload.get("vid") or ""),
                resolution=str(payload.get("resolution") or "1080p"),
                config=str(payload.get("config") or "aigc"),
                repair_style=int(payload.get("repairStyle") if payload.get("repairStyle") is not None else 1),
                repair_strength=int(payload.get("repairStrength") if payload.get("repairStrength") is not None else 0),
                fps=float(payload["fps"]) if payload.get("fps") is not None else None,
                space_name=str(payload.get("spaceName") or ""),
            )
            self._send_json(200, result)
        except WorkerError as error:
            logger.warning("http vod enhancement start failed", {"traceId": trace_id, "error": str(error)})
            self._send_json(error.status_code, {"ok": False, "message": str(error)})
        except Exception as error:
            logger.error("http vod enhancement start crashed", {"traceId": trace_id, "error": str(error)})
            self._send_json(500, {"ok": False, "message": str(error) or "AI Worker 内部错误"})

    def _handle_vod_enhancement_get(self):
        trace_id = self.headers.get("X-Trace-Id", "")
        try:
            payload = self._read_json()
            result = vod_enhancement_service.get_execution(str(payload.get("runId") or ""))
            self._send_json(200, result)
        except WorkerError as error:
            logger.warning("http vod enhancement get failed", {"traceId": trace_id, "error": str(error)})
            self._send_json(error.status_code, {"ok": False, "message": str(error)})
        except Exception as error:
            logger.error("http vod enhancement get crashed", {"traceId": trace_id, "error": str(error)})
            self._send_json(500, {"ok": False, "message": str(error) or "AI Worker 内部错误"})

    def _handle_legacy_generate(self):
        payload = self._read_json()
        workflow = payload.get("workflow") or []
        steps = "\n".join([f"{index + 1}. {step}" for index, step in enumerate(workflow)])
        result = "\n".join([
            f"任务 {payload.get('taskId')} 已由 Python worker 处理。",
            f"模块：{payload.get('moduleName')} ({payload.get('moduleCode')})",
            "",
            "创作输入：",
            payload.get("prompt", ""),
            "",
            "执行流程：",
            steps,
            "",
            "后续可在这里接入真实模型、素材处理、转码和任务队列。",
        ])
        self._send_json(200, {"result": result})

    def log_message(self, format, *args):
        return


def run():
    server = ThreadingHTTPServer((settings.host, settings.port), AiWorkerHandler)
    print(f"Python AI worker listening on http://{settings.host}:{settings.port}")
    logger.info("ai worker started", {
        "host": settings.host,
        "port": settings.port,
        "vodCredentials": vod_upload_service.credentials_diagnostics(),
        "vodUnderstanding": vod_understanding_service.diagnostics(),
        "vodEnhancement": vod_enhancement_service.diagnostics(),
    })
    server.serve_forever()


if __name__ == "__main__":
    run()

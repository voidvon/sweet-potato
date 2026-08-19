from __future__ import annotations

import json
import os
import re
import threading
import time
import traceback
from importlib import metadata as importlib_metadata
from pathlib import Path
from typing import Any

from ai_worker.config import settings
from ai_worker.domain.errors import ValidationError, WorkerError
from ai_worker.infra import logger


_upload_progress_lock = threading.Lock()
_upload_progress: dict[str, dict] = {}


def _set_upload_progress(upload_id: str, progress: int, state: str = "uploading", message: str = "") -> None:
    if not upload_id:
        return
    normalized = max(0, min(100, int(progress)))
    with _upload_progress_lock:
        current = _upload_progress.get(upload_id, {})
        _upload_progress[upload_id] = {
            **current,
            "ok": True,
            "uploadId": upload_id,
            "progress": normalized,
            "state": state,
            "message": message,
            "updatedAt": time.time(),
        }


def _read_attr(obj: Any, name: str, default: Any = "") -> Any:
    return getattr(obj, name, default)


def _first_env(*names: str) -> tuple[str, str]:
    for name in names:
        value = os.environ.get(name, "").strip()
        if value:
            return value, name
    return "", ""


def _credential_hint(value: str) -> dict:
    if not value:
        return {"present": False}
    return {
        "present": True,
        "length": len(value),
        "prefix": value[:4],
        "suffix": value[-4:],
    }


def _vod_credentials() -> tuple[str, str, str, str]:
    ak, ak_source = _first_env(
        "VOLCENGINE_ACCESS_KEY_ID",
        "VOLCENGINE_ACCESS_KEY",
        "VOLCENGINE_VOD_ACCESS_KEY_ID",
        "VOLCENGINE_VOD_ACCESS_KEY",
        "VOLC_ACCESSKEY",
        "VOLC_ACCESS_KEY",
        "VOLC_ACCESS_KEY_ID",
        "VOLC_AK",
    )
    sk, sk_source = _first_env(
        "VOLCENGINE_SECRET_ACCESS_KEY",
        "VOLCENGINE_SECRET_KEY",
        "VOLCENGINE_VOD_SECRET_ACCESS_KEY",
        "VOLCENGINE_VOD_SECRET_KEY",
        "VOLC_SECRETKEY",
        "VOLC_SECRET_KEY",
        "VOLC_SECRET_ACCESS_KEY",
        "VOLC_SK",
    )
    return ak, ak_source, sk, sk_source


def _ensure_official_env_credentials() -> dict:
    ak, ak_source, sk, sk_source = _vod_credentials()
    injected = {"VOLC_ACCESSKEY": False, "VOLC_SECRETKEY": False}
    if ak and os.environ.get("VOLC_ACCESSKEY") != ak:
        os.environ["VOLC_ACCESSKEY"] = ak
        injected["VOLC_ACCESSKEY"] = True
    if sk and os.environ.get("VOLC_SECRETKEY") != sk:
        os.environ["VOLC_SECRETKEY"] = sk
        injected["VOLC_SECRETKEY"] = True
    return {
        "akSource": ak_source,
        "skSource": sk_source,
        "injectedOfficialEnv": injected,
    }


def _sdk_diagnostics() -> dict:
    version = ""
    module_path = ""
    try:
        version = importlib_metadata.version("volcengine")
    except importlib_metadata.PackageNotFoundError:
        version = ""
    try:
        import volcengine

        module_path = str(getattr(volcengine, "__file__", "") or "")
    except Exception:
        module_path = ""
    return {
        "package": "volcengine",
        "version": version,
        "modulePath": module_path,
    }


def _safe_slug(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]+", "-", value).strip("-._")


def _safe_vod_file_name(file_name: str, fallback_suffix: str, unique_name: str = "") -> str:
    path = Path(file_name)
    suffix = path.suffix or fallback_suffix or ".mp4"
    stem = path.stem or ""
    unique_stem = Path(unique_name).stem if unique_name else ""
    safe_stem = _safe_slug(stem)
    safe_unique_stem = _safe_slug(unique_stem)
    if safe_unique_stem and safe_unique_stem != safe_stem:
        safe_stem = f"{safe_stem}-{safe_unique_stem}" if safe_stem else safe_unique_stem
    safe_stem = safe_stem or "video"
    safe_suffix = re.sub(r"[^A-Za-z0-9.]+", "", suffix) or ".mp4"
    if not safe_suffix.startswith("."):
        safe_suffix = f".{safe_suffix}"
    return f"video-uploads/{safe_stem}{safe_suffix}"


def _vod_upload_request_diagnostics(req: Any, path: Path) -> dict:
    upload_host_prefer = _read_attr(req, "UploadHostPrefer", "")
    return {
        "SpaceName": _read_attr(req, "SpaceName", ""),
        "FilePath": _read_attr(req, "FilePath", ""),
        "FileName": _read_attr(req, "FileName", ""),
        "FileExtension": _read_attr(req, "FileExtension", ""),
        "Functions": _read_attr(req, "Functions", ""),
        "CallbackArgs": _read_attr(req, "CallbackArgs", ""),
        "StorageClass": _read_attr(req, "StorageClass", 0),
        "UploadHostPrefer": upload_host_prefer,
        "UploadHostPreferSet": bool(upload_host_prefer),
        "localFile": {
            "exists": path.exists(),
            "isFile": path.is_file(),
            "sizeBytes": path.stat().st_size if path.exists() and path.is_file() else 0,
            "suffix": path.suffix,
        },
    }


def _protobuf_request_diagnostics(req: Any) -> dict:
    fields = [
        "SpaceName",
        "FileSize",
        "FileType",
        "FileName",
        "FileExtension",
        "StorageClass",
        "ClientNetWorkMode",
        "ClientIDCMode",
        "NeedFallback",
        "UploadHostPrefer",
        "ChunkSize",
        "SessionKey",
        "Functions",
        "CallbackArgs",
        "ExpireTime",
    ]
    return {field: _read_attr(req, field, "") for field in fields if _read_attr(req, field, "") not in ("", 0, False)}


def _install_vod_stage_logging(service: Any) -> None:
    original_apply_upload_info = service.apply_upload_info

    def traced_apply_upload_info(request: Any):
        logger.info("vod sdk stage entering ApplyUploadInfo", {
            "request": _protobuf_request_diagnostics(request),
            "host": _read_attr(service.service_info, "host", ""),
            "scheme": _read_attr(service.service_info, "scheme", ""),
            "credentialRegion": _read_attr(service.service_info.credentials, "region", ""),
            "credentialService": _read_attr(service.service_info.credentials, "service", ""),
        })
        try:
            response = original_apply_upload_info(request)
        except Exception as error:
            logger.error("vod sdk stage failed ApplyUploadInfo", {
                "error": str(error),
                "errorType": type(error).__name__,
                "traceback": traceback.format_exc(),
                "request": _protobuf_request_diagnostics(request),
            })
            raise
        metadata = _read_attr(response, "ResponseMetadata", None)
        response_error = _read_attr(metadata, "Error", None)
        logger.info("vod sdk stage completed ApplyUploadInfo", {
            "requestId": _read_attr(metadata, "RequestId", "") if metadata else "",
            "errorCode": _read_attr(response_error, "Code", "") if response_error else "",
            "errorMessage": _read_attr(response_error, "Message", "") if response_error else "",
        })
        return response

    service.apply_upload_info = traced_apply_upload_info


def _install_vod_upload_progress(service: Any, upload_id: str, file_size: int) -> None:
    if not upload_id or file_size <= 0:
        return
    original_direct_upload = service.direct_upload
    original_chunk_upload = service.chunk_upload
    original_vpc_upload = service.vpc_upload

    def emit(progress: int, message: str = "视频正在上传中..") -> None:
        _set_upload_progress(upload_id, progress, "uploading", message)

    def start_heartbeat(start: int = 8, end: int = 90, interval: float = 1.5):
        stop_event = threading.Event()

        def run() -> None:
            progress = start
            while not stop_event.wait(interval):
                with _upload_progress_lock:
                    current = _upload_progress.get(upload_id, {})
                    current_progress = int(current.get("progress") or progress)
                    state = current.get("state")
                if state in ("completed", "failed"):
                    return
                progress = min(end, max(progress + 1, current_progress + 1))
                emit(progress)
                if progress >= end:
                    return

        thread = threading.Thread(target=run, daemon=True)
        thread.start()
        return stop_event

    def traced_direct_upload(*args: Any, **kwargs: Any):
        emit(8)
        heartbeat = start_heartbeat(8, 90)
        try:
            result = original_direct_upload(*args, **kwargs)
            emit(95)
            return result
        except Exception:
            _set_upload_progress(upload_id, 0, "failed", "视频上传到火山引擎失败")
            raise
        finally:
            heartbeat.set()

    def traced_chunk_upload(file_path: str, host: str, oid: str, auth: str, size: int, is_large_file: bool, storage_class: Any, chunk_size: int):
        effective_size = size or file_size
        effective_chunk = max(1, int(chunk_size or effective_size))
        uploaded = 0
        upload_id_from_tos = service.init_upload_part(host, oid, auth, is_large_file, storage_class)
        n = effective_size // effective_chunk
        last_num = n - 1
        parts = []
        meta = {}
        emit(5)
        with open(file_path, "rb") as f:
            for i in range(0, last_num):
                data = f.read(effective_chunk)
                part_number = i + 1 if is_large_file else i
                part, payload = service.upload_part(host, oid, auth, upload_id_from_tos, part_number, data, is_large_file, storage_class)
                if part_number == 1:
                    meta = payload["meta"]
                parts.append(part)
                uploaded += len(data)
                emit(min(94, max(6, round(uploaded / effective_size * 95))))
            data = f.read()
            if is_large_file:
                last_num = last_num + 1
            part, payload = service.upload_part(host, oid, auth, upload_id_from_tos, last_num, data, is_large_file, storage_class)
            if last_num == 1:
                meta = payload["meta"]
            parts.append(part)
            uploaded += len(data)
            emit(min(96, max(6, round(uploaded / effective_size * 95))))
        result = service.upload_merge_part(host, oid, auth, upload_id_from_tos, parts, is_large_file, storage_class, meta)
        emit(98)
        return result

    def traced_vpc_upload(*args: Any, **kwargs: Any):
        emit(8)
        heartbeat = start_heartbeat(8, 90)
        try:
            result = original_vpc_upload(*args, **kwargs)
            emit(95)
            return result
        except Exception:
            _set_upload_progress(upload_id, 0, "failed", "视频上传到火山引擎失败")
            raise
        finally:
            heartbeat.set()

    service.direct_upload = traced_direct_upload
    service.chunk_upload = traced_chunk_upload
    service.vpc_upload = traced_vpc_upload


def _source_info_to_dict(source_info: Any, fallback_file_name: str = "") -> dict:
    return {
        "fileName": _read_attr(source_info, "FileName", fallback_file_name) if source_info else fallback_file_name,
        "fileType": _read_attr(source_info, "FileType", "") if source_info else "",
        "storeUri": _read_attr(source_info, "StoreUri", "") if source_info else "",
        "height": _read_attr(source_info, "Height", 0) if source_info else 0,
        "width": _read_attr(source_info, "Width", 0) if source_info else 0,
        "duration": _read_attr(source_info, "Duration", 0) if source_info else 0,
        "size": _read_attr(source_info, "Size", 0) if source_info else 0,
        "format": _read_attr(source_info, "Format", "") if source_info else "",
        "fps": _read_attr(source_info, "Fps", 0) if source_info else 0,
    }


def _media_source_info_by_vid(service: Any, vid: str, fallback_file_name: str = "") -> dict:
    if not vid:
        return {}
    try:
        from volcengine.vod.models.request.request_vod_pb2 import VodGetMediaInfosRequest
    except Exception:
        return {}
    for attempt in range(3):
        try:
            req = VodGetMediaInfosRequest()
            req.Vids = vid
            resp = service.get_media_infos(req)
            metadata = _read_attr(resp, "ResponseMetadata", None)
            error = _read_attr(metadata, "Error", None)
            if _read_attr(error, "Code", ""):
                logger.warning("vod get media infos returned error", {
                    "vid": vid,
                    "code": _read_attr(error, "Code", ""),
                    "message": _read_attr(error, "Message", ""),
                })
                return {}
            media_infos = list(_read_attr(_read_attr(resp, "Result", None), "MediaInfoList", []) or [])
            if media_infos:
                source_info = _read_attr(media_infos[0], "SourceInfo", None)
                result = _source_info_to_dict(source_info, fallback_file_name)
                if result.get("duration") or attempt >= 2:
                    return result
        except Exception as error:
            logger.warning("vod get media infos failed", {"vid": vid, "attempt": attempt + 1, "error": str(error)})
            return {}
        time.sleep(1)
    return {}


def _result_from_existing_file(service: Any, file_name: str, request_id: str = "") -> dict | None:
    try:
        from volcengine.vod.models.request.request_vod_pb2 import VodListFileMetaInfosByFileNamesRequest
    except Exception:
        return None

    req = VodListFileMetaInfosByFileNamesRequest()
    req.SpaceName = settings.vod_space_name
    req.FileNameEncodeds = file_name
    resp = service.list_file_meta_infos_by_file_names(req)
    infos = list(_read_attr(_read_attr(resp, "Result", None), "VodFileMetaInfos", []) or [])
    for item in infos:
        vid = _read_attr(item, "Vid", "")
        if vid:
            source_info = _media_source_info_by_vid(service, vid, file_name)
            return {
                "ok": True,
                "reused": True,
                "vid": vid,
                "spaceName": settings.vod_space_name,
                "posterUri": "",
                "requestId": request_id or _read_attr(_read_attr(resp, "ResponseMetadata", None), "RequestId", ""),
                "sourceInfo": source_info or {
                    "fileName": _read_attr(item, "FileName", file_name) or file_name,
                    "height": 0,
                    "width": 0,
                    "duration": 0,
                },
            }
    return None


class VodUploadService:
    def upload_progress(self, upload_id: str) -> dict:
        if not upload_id:
            return {"ok": False, "message": "缺少 uploadId"}
        with _upload_progress_lock:
            current = dict(_upload_progress.get(upload_id) or {})
        return current or {
            "ok": True,
            "uploadId": upload_id,
            "progress": 0,
            "state": "pending",
            "message": "等待上传开始",
        }

    def credentials_diagnostics(self) -> dict:
        ak, ak_source, sk, sk_source = _vod_credentials()
        return {
            "ok": bool(ak and sk),
            "spaceName": settings.vod_space_name,
            "region": settings.vod_region,
            "sdk": _sdk_diagnostics(),
            "akSource": ak_source,
            "skSource": sk_source,
            "ak": _credential_hint(ak),
            "sk": _credential_hint(sk),
            "officialEnvNames": {
                "ak": "VOLC_ACCESSKEY",
                "sk": "VOLC_SECRETKEY",
            },
        }

    def upload_local_video(self, file_path: str, file_name: str, title: str = "", upload_id: str = "") -> dict:
        path = Path(file_path).expanduser().resolve()
        if not path.exists() or not path.is_file():
            raise ValidationError(f"视频文件不存在：{path}")
        if not settings.vod_space_name:
            raise ValidationError("缺少 VOD 空间配置，请设置 VOLCENGINE_VOD_SPACE_NAME")

        try:
            from volcengine.util.Functions import Function
            from volcengine.vod.VodService import VodService
            from volcengine.vod.models.request.request_vod_pb2 import VodUploadMediaRequest
        except Exception as error:
            raise WorkerError("缺少火山引擎 VOD Python SDK，请在 ai-worker 环境安装：pip install -U volcengine") from error

        credential_env = _ensure_official_env_credentials()
        service = VodService(settings.vod_region) if settings.vod_region else VodService()
        _install_vod_stage_logging(service)
        _set_upload_progress(upload_id, 1, "uploading", "视频正在上传中..")
        _install_vod_upload_progress(service, upload_id, path.stat().st_size)
        ak, ak_source, sk, sk_source = _vod_credentials()
        if ak:
            service.set_ak(ak)
        if sk:
            service.set_sk(sk)

        req = VodUploadMediaRequest()
        req.SpaceName = settings.vod_space_name
        req.FilePath = str(path)
        req.FileName = _safe_vod_file_name(file_name or path.name, path.suffix, path.name)
        req.FileExtension = path.suffix or ".mp4"
        req.Functions = json.dumps([Function.get_meta_func()], ensure_ascii=False)
        req.CallbackArgs = ""
        req.StorageClass = 1
        req.UploadHostPrefer = settings.vod_upload_host_prefer

        sdk_request = _vod_upload_request_diagnostics(req, path)
        credentials = {
            "sdk": _sdk_diagnostics(),
            "officialEnv": credential_env,
            "akSource": ak_source,
            "skSource": sk_source,
            "ak": _credential_hint(ak),
            "sk": _credential_hint(sk),
        }
        logger.info("vod upload sdk request prepared", {
            "originalFileName": file_name or path.name,
            "title": title,
            "region": settings.vod_region,
            "sdkRequest": sdk_request,
            "credentials": credentials,
        })
        try:
            logger.info("vod upload sdk call entering upload_media", {"stage": "upload_media"})
            resp = service.upload_media(req)
        except Exception as error:
            stack = traceback.format_exc()
            logger.error("vod upload request crashed", {
                "error": str(error),
                "errorType": type(error).__name__,
                "traceback": stack,
                "sdkRequest": sdk_request,
                "credentials": credentials,
            })
            if re.search(r"already\s+existed|already\s+exists|file\s+exists", str(error), re.IGNORECASE):
                reused = _result_from_existing_file(service, req.FileName)
                if reused:
                    logger.info("vod upload reused existing file after sdk duplicate error", {
                        "fileName": req.FileName,
                        "vid": reused["vid"],
                    })
                    return reused
            if "InvalidCredential" in str(error):
                raise WorkerError(
                    "火山引擎 VOD 上传失败：InvalidCredential。请确认 ai-worker 进程读取到的是火山引擎访问控制 AK/SK，"
                    "不是 Ark API Key；并确认该 AK/SK 有视频点播空间上传权限。"
                ) from error
            if "SignatureDoesNotMatch" in str(error):
                raise WorkerError(
                    "火山引擎 VOD 上传失败：SignatureDoesNotMatch。请确认 SK 与 AK 匹配、ai-worker 所在机器时间准确，"
                    "并确认 ai-worker 实际加载的是新版 volcengine SDK；系统已将上传到 VOD 的对象名规整为英文安全路径，"
                    "也不会传入空 UploadHostPrefer。"
                ) from error
            if "AccessDenied" in str(error):
                raise WorkerError(
                    f"火山引擎 VOD 上传失败：AccessDenied。当前 AK/SK 没有上传到 VOD 空间 {settings.vod_space_name} 的权限，"
                    "请在火山 IAM 给该用户授权视频点播上传/媒资管理相关权限，并确认 VOLCENGINE_VOD_SPACE_NAME 配置的是该账号可访问的空间。"
                ) from error
            raise WorkerError(f"火山引擎 VOD 上传失败：{error}") from error

        metadata = _read_attr(resp, "ResponseMetadata", None)
        error = _read_attr(metadata, "Error", None)
        error_code = _read_attr(error, "Code", "") if error else ""
        if error_code:
            request_id = _read_attr(metadata, "RequestId", "") if metadata else ""
            message = _read_attr(error, "Message", "")
            logger.warning("vod upload returned error", {
                "fileName": req.FileName,
                "code": error_code,
                "message": message,
                "requestId": request_id,
                "sdkRequest": sdk_request,
                "credentials": credentials,
            })
            if re.search(r"already\s+existed|already\s+exists|file\s+exists", f"{error_code} {message}", re.IGNORECASE):
                reused = _result_from_existing_file(service, req.FileName, request_id)
                if reused:
                    logger.info("vod upload reused existing file after duplicate response", {
                        "fileName": req.FileName,
                        "vid": reused["vid"],
                        "requestId": request_id,
                    })
                    return reused
            if error_code == "InvalidCredential":
                raise WorkerError(
                    "火山引擎 VOD 返回错误：InvalidCredential。请确认 ai-worker 进程读取到的是火山引擎访问控制 AK/SK，"
                    "不是 Ark API Key；并确认该 AK/SK 有视频点播空间上传权限。"
                )
            if error_code == "SignatureDoesNotMatch":
                raise WorkerError(
                    "火山引擎 VOD 返回错误：SignatureDoesNotMatch。请确认 SK 与 AK 匹配、ai-worker 所在机器时间准确，"
                    "并确认 ai-worker 实际加载的是新版 volcengine SDK；系统已将上传到 VOD 的对象名规整为英文安全路径，"
                    "也不会传入空 UploadHostPrefer。"
                )
            if error_code == "AccessDenied":
                raise WorkerError(
                    f"火山引擎 VOD 返回错误：AccessDenied。当前 AK/SK 没有上传到 VOD 空间 {settings.vod_space_name} 的权限，"
                    "请在火山 IAM 给该用户授权视频点播上传/媒资管理相关权限，并确认 VOLCENGINE_VOD_SPACE_NAME 配置的是该账号可访问的空间。"
                )
            raise WorkerError(f"火山引擎 VOD 返回错误：{error_code} {message}")

        data = _read_attr(_read_attr(resp, "Result", None), "Data", None)
        source_info = _read_attr(data, "SourceInfo", None)
        vid = _read_attr(data, "Vid", "")
        source_info_dict = _source_info_to_dict(source_info, req.FileName)
        media_source_info = _media_source_info_by_vid(service, vid, req.FileName)
        if media_source_info:
            source_info_dict = {**source_info_dict, **{key: value for key, value in media_source_info.items() if value not in ("", 0, None)}}
        result = {
            "ok": True,
            "vid": vid,
            "spaceName": settings.vod_space_name,
            "posterUri": _read_attr(data, "PosterUri", ""),
            "requestId": _read_attr(metadata, "RequestId", "") if metadata else "",
            "sourceInfo": source_info_dict,
        }
        if not result["vid"]:
            raise WorkerError("火山引擎 VOD 上传成功但未返回 Vid")
        _set_upload_progress(upload_id, 100, "completed", "视频上传完成")
        logger.info("vod upload request completed", {
            "fileName": req.FileName,
            "vid": result["vid"],
            "requestId": result["requestId"],
        })
        return result

from __future__ import annotations

import traceback
from typing import Any

from ai_worker.config import settings
from ai_worker.domain.errors import ValidationError, WorkerError
from ai_worker.infra import logger
from ai_worker.services.vod_upload_service import _credential_hint, _vod_credentials


ALLOWED_MODES = {"auto", "auto_region", "manual"}
ALLOWED_CONTENT_TYPES = {"subtitle", "text"}
ALLOWED_CLIP_MODES = {"all", "selected", "skip"}


def _model_to_dict(value: Any) -> dict:
    if hasattr(value, "to_dict"):
        return value.to_dict()
    return value if isinstance(value, dict) else {}


def _value_at(data: Any, *path: str) -> Any:
    current = data
    for key in path:
        if not isinstance(current, dict):
            return None
        current = current.get(key)
    return current


def _first_value(data: dict, paths: list[tuple[str, ...]]) -> Any:
    for path in paths:
        value = _value_at(data, *path)
        if value not in (None, ""):
            return value
    return None


def _normalized_location(value: Any) -> dict:
    if not isinstance(value, dict):
        raise ValidationError("字幕擦除区域格式无效")
    location = {
        "topLeftX": float(value.get("topLeftX", -1)),
        "topLeftY": float(value.get("topLeftY", -1)),
        "bottomRightX": float(value.get("bottomRightX", -1)),
        "bottomRightY": float(value.get("bottomRightY", -1)),
    }
    if not all(0 <= number <= 1 for number in location.values()):
        raise ValidationError("字幕擦除区域坐标必须在 0 到 1 之间")
    if location["topLeftX"] >= location["bottomRightX"] or location["topLeftY"] >= location["bottomRightY"]:
        raise ValidationError("字幕擦除区域的右下角必须位于左上角之后")
    return location


class VodSubtitleRemovalService:
    def _client(self):
        try:
            import volcenginesdkcore
            from volcenginesdkvod20250101.api import VOD20250101Api
        except Exception as error:
            raise WorkerError("缺少火山引擎 VOD V2 Python SDK，请安装：pip install -U volcengine-python-sdk") from error

        ak, _, sk, _ = _vod_credentials()
        if not ak or not sk:
            raise ValidationError("缺少火山引擎 AK/SK，请配置 VOLC_ACCESSKEY/VOLC_SECRETKEY")
        configuration = volcenginesdkcore.Configuration()
        configuration.ak = ak
        configuration.sk = sk
        configuration.region = settings.vod_region or "cn-north-1"
        return VOD20250101Api(volcenginesdkcore.ApiClient(configuration))

    def diagnostics(self) -> dict:
        ak, ak_source, sk, sk_source = _vod_credentials()
        return {
            "ok": bool(ak and sk and settings.vod_space_name),
            "spaceName": settings.vod_space_name,
            "region": settings.vod_region or "cn-north-1",
            "akSource": ak_source,
            "skSource": sk_source,
            "ak": _credential_hint(ak),
            "sk": _credential_hint(sk),
        }

    def start(
        self,
        vid: str,
        mode: str = "auto",
        content_type: str = "subtitle",
        locations: list[dict] | None = None,
        clip_filter: dict | None = None,
        space_name: str = "",
    ) -> dict:
        vid = vid.strip()
        mode = mode.strip().lower()
        content_type = content_type.strip().lower()
        resolved_space_name = space_name.strip() or settings.vod_space_name
        if not vid:
            raise ValidationError("缺少 VOD Vid")
        if not resolved_space_name:
            raise ValidationError("缺少 VOD 空间配置，请设置 VOLCENGINE_VOD_SPACE_NAME")
        if mode not in ALLOWED_MODES:
            raise ValidationError(f"不支持的字幕擦除模式：{mode}")
        if content_type not in ALLOWED_CONTENT_TYPES:
            raise ValidationError(f"不支持的擦除内容类型：{content_type}")

        normalized_locations = [_normalized_location(item) for item in (locations or [])]
        if mode != "auto" and not normalized_locations:
            raise ValidationError("区域擦除模式必须至少指定一个擦除区域")
        normalized_clip_filter = clip_filter if isinstance(clip_filter, dict) else {}
        clip_mode = str(normalized_clip_filter.get("mode") or "all").lower()
        if clip_mode not in ALLOWED_CLIP_MODES:
            raise ValidationError(f"不支持的时间范围模式：{clip_mode}")

        try:
            from volcenginesdkvod20250101.models import (
                AutoForStartExecutionInput,
                ClipFilterForStartExecutionInput,
                ClipForStartExecutionInput,
                ConvertOperationForStartExecutionInput,
                EraseForStartExecutionInput,
                EraseOptionForStartExecutionInput,
                InputForStartExecutionInput,
                LocationForStartExecutionInput,
                ManualForStartExecutionInput,
                RatioLocationForStartExecutionInput,
                StartExecutionRequest,
                SubtitleFilterForStartExecutionInput,
                TaskForStartExecutionInput,
            )
        except Exception as error:
            raise WorkerError("当前 VOD V2 SDK 缺少字幕擦除模型，请升级 volcengine-python-sdk") from error

        location_models = [
            LocationForStartExecutionInput(
                ratio_location=RatioLocationForStartExecutionInput(
                    top_left_x=item["topLeftX"],
                    top_left_y=item["topLeftY"],
                    bottom_right_x=item["bottomRightX"],
                    bottom_right_y=item["bottomRightY"],
                )
            )
            for item in normalized_locations
        ]
        erase_option = None
        if clip_mode != "all":
            start = float(normalized_clip_filter.get("start", 0))
            end = float(normalized_clip_filter.get("end", 0))
            if start < 0 or end <= start:
                raise ValidationError("字幕擦除时间范围无效")
            erase_option = EraseOptionForStartExecutionInput(
                clip_filter=ClipFilterForStartExecutionInput(
                    mode="Selected" if clip_mode == "selected" else "Skip",
                    clips=[ClipForStartExecutionInput(start=start, end=end)],
                )
            )

        api_mode = "Manual" if mode == "manual" else "Auto"
        erase = EraseForStartExecutionInput(
            mode=api_mode,
            auto=AutoForStartExecutionInput(
                type="Text" if content_type == "text" else "Subtitle",
                subtitle_filter=SubtitleFilterForStartExecutionInput() if content_type == "subtitle" else None,
                locations=location_models if mode == "auto_region" else None,
            ) if api_mode == "Auto" else None,
            manual=ManualForStartExecutionInput(locations=location_models) if api_mode == "Manual" else None,
            erase_option=erase_option,
            with_erase_info=True,
            new_vid=True,
        )
        request = StartExecutionRequest(
            space_name=resolved_space_name,
            input=InputForStartExecutionInput(type="Vid", vid=vid),
            operation=ConvertOperationForStartExecutionInput(
                type="Task",
                task=TaskForStartExecutionInput(type="Erase", erase=erase),
            ),
        )
        logger.info("vod subtitle removal start execution request", {
            "vid": vid,
            "spaceName": resolved_space_name,
            "mode": mode,
            "contentType": content_type,
            "locations": normalized_locations,
            "clipFilter": normalized_clip_filter,
        })
        try:
            response = self._client().start_execution(request)
        except Exception as error:
            logger.error("vod subtitle removal start execution failed", {
                "vid": vid,
                "error": str(error),
                "traceback": traceback.format_exc(),
            })
            raise WorkerError(f"提交字幕擦除任务失败：{error}") from error
        data = _model_to_dict(response)
        run_id = str(data.get("run_id") or data.get("RunId") or getattr(response, "run_id", "") or "").strip()
        if not run_id:
            raise WorkerError("提交字幕擦除任务成功但未返回 RunId")
        return {
            "ok": True,
            "runId": run_id,
            "vid": vid,
            "spaceName": resolved_space_name,
            "mode": mode,
            "contentType": content_type,
            "raw": data,
        }

    def get_execution(self, run_id: str) -> dict:
        run_id = run_id.strip()
        if not run_id:
            raise ValidationError("缺少 RunId")
        try:
            from volcenginesdkvod20250101.models import GetExecutionRequest
        except Exception as error:
            raise WorkerError("当前 VOD V2 SDK 缺少 GetExecution 模型") from error
        try:
            response = self._client().get_execution(GetExecutionRequest(run_id=run_id))
        except Exception as error:
            logger.error("vod subtitle removal get execution failed", {
                "runId": run_id,
                "error": str(error),
                "traceback": traceback.format_exc(),
            })
            raise WorkerError(f"查询字幕擦除任务失败：{error}") from error

        data = _model_to_dict(response)
        status = str(data.get("status") or data.get("Status") or getattr(response, "status", "") or "")
        erase = _first_value(data, [
            ("output", "task", "erase"),
            ("Output", "Task", "Erase"),
        ])
        erase = erase if isinstance(erase, dict) else {}
        file_data = erase.get("file") or erase.get("File") or {}
        file_data = file_data if isinstance(file_data, dict) else {}
        file_name = str(file_data.get("file_name") or file_data.get("FileName") or "").strip()
        output_vid = str(file_data.get("vid") or file_data.get("Vid") or "").strip()
        duration_value = erase.get("duration") if erase.get("duration") is not None else erase.get("Duration")
        try:
            duration = float(duration_value) if duration_value is not None else None
        except (TypeError, ValueError):
            duration = None
        error_message = str(_first_value(data, [
            ("message",),
            ("Message",),
            ("meta", "error", "message"),
            ("Meta", "Error", "Message"),
        ]) or "").strip()
        logger.info("vod subtitle removal get execution response", {
            "runId": run_id,
            "status": status,
            "fileName": file_name,
            "outputVid": output_vid,
            "duration": duration,
            "hasErrorMessage": bool(error_message),
        })
        return {
            "ok": True,
            "runId": run_id,
            "status": status,
            "fileName": file_name,
            "vid": output_vid,
            "duration": duration,
            "errorMessage": error_message,
            "raw": data,
        }

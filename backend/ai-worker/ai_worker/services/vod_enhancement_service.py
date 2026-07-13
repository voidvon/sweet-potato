from __future__ import annotations

import traceback
from typing import Any

from ai_worker.config import settings
from ai_worker.domain.errors import ValidationError, WorkerError
from ai_worker.infra import logger
from ai_worker.services.vod_upload_service import _credential_hint, _vod_credentials


ALLOWED_RESOLUTIONS = {"1080p", "2k", "4k"}
ALLOWED_CONFIGS = {"aigc", "short_series", "ugc", "old_film", "common"}


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


class VodEnhancementService:
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
        resolution: str = "1080p",
        config: str = "aigc",
        repair_style: int = 1,
        repair_strength: int = 0,
        fps: float | None = None,
        space_name: str = "",
    ) -> dict:
        vid = vid.strip()
        resolution = resolution.strip().lower()
        config = config.strip().lower()
        resolved_space_name = space_name.strip() or settings.vod_space_name
        if not vid:
            raise ValidationError("缺少 VOD Vid")
        if not resolved_space_name:
            raise ValidationError("缺少 VOD 空间配置，请设置 VOLCENGINE_VOD_SPACE_NAME")
        if resolution not in ALLOWED_RESOLUTIONS:
            raise ValidationError(f"不支持的目标分辨率：{resolution}")
        if config not in ALLOWED_CONFIGS:
            raise ValidationError(f"不支持的画质增强场景：{config}")
        if fps is not None and (fps <= 0 or fps > 240):
            raise ValidationError("目标帧率必须在 0 到 240 之间")

        try:
            from volcenginesdkvod20250101.models import (
                ConvertOperationForStartExecutionInput,
                EnhanceForStartExecutionInput,
                InputForStartExecutionInput,
                MoeEnhanceForStartExecutionInput,
                StartExecutionRequest,
                TargetForStartExecutionInput,
                TaskForStartExecutionInput,
                VideoStrategyForStartExecutionInput,
            )
        except Exception as error:
            raise WorkerError("当前 VOD V2 SDK 缺少画质增强模型，请升级 volcengine-python-sdk") from error

        request = StartExecutionRequest(
            space_name=resolved_space_name,
            input=InputForStartExecutionInput(type="Vid", vid=vid),
            operation=ConvertOperationForStartExecutionInput(
                type="Task",
                task=TaskForStartExecutionInput(
                    type="Enhance",
                    enhance=EnhanceForStartExecutionInput(
                        type="Moe",
                        moe_enhance=MoeEnhanceForStartExecutionInput(
                            config=config,
                            target=TargetForStartExecutionInput(res=resolution, fps=fps),
                            video_strategy=VideoStrategyForStartExecutionInput(
                                repair_style=repair_style,
                                repair_strength=repair_strength,
                            ),
                        ),
                    ),
                ),
            ),
        )
        logger.info("vod enhancement start execution request", {
            "vid": vid,
            "spaceName": resolved_space_name,
            "resolution": resolution,
            "config": config,
            "repairStyle": repair_style,
            "repairStrength": repair_strength,
            "fps": fps,
        })
        try:
            response = self._client().start_execution(request)
        except Exception as error:
            logger.error("vod enhancement start execution failed", {
                "vid": vid,
                "error": str(error),
                "traceback": traceback.format_exc(),
            })
            raise WorkerError(f"提交视频画质增强任务失败：{error}") from error
        data = _model_to_dict(response)
        run_id = str(data.get("run_id") or data.get("RunId") or getattr(response, "run_id", "") or "").strip()
        if not run_id:
            raise WorkerError("提交视频画质增强任务成功但未返回 RunId")
        return {
            "ok": True,
            "runId": run_id,
            "vid": vid,
            "spaceName": resolved_space_name,
            "resolution": resolution,
            "config": config,
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
            logger.error("vod enhancement get execution failed", {
                "runId": run_id,
                "error": str(error),
                "traceback": traceback.format_exc(),
            })
            raise WorkerError(f"查询视频画质增强任务失败：{error}") from error

        data = _model_to_dict(response)
        status = str(data.get("status") or data.get("Status") or getattr(response, "status", "") or "")
        store_uri = str(_first_value(data, [
            ("output", "task", "enhance", "store_uri"),
            ("output", "task", "enhance", "StoreUri"),
            ("Output", "Task", "Enhance", "StoreUri"),
            ("Output", "Task", "Enhance", "store_uri"),
        ]) or "").strip()
        error_message = str(_first_value(data, [
            ("message",),
            ("Message",),
            ("meta", "error", "message"),
            ("Meta", "Error", "Message"),
        ]) or "").strip()
        logger.info("vod enhancement get execution response", {
            "runId": run_id,
            "status": status,
            "storeUri": store_uri,
            "hasErrorMessage": bool(error_message),
        })
        return {
            "ok": True,
            "runId": run_id,
            "status": status,
            "storeUri": store_uri,
            "errorMessage": error_message,
            "raw": data,
        }

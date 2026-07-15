from __future__ import annotations

import traceback
from typing import Any

from ai_worker.config import settings
from ai_worker.domain.errors import ValidationError, WorkerError
from ai_worker.infra import logger
from ai_worker.services.vod_upload_service import _credential_hint, _vod_credentials


SOURCE_LANGUAGES = {"zh", "en"}
TARGET_LANGUAGES = {"zh", "en", "ja", "ko", "de", "fr", "ru", "es", "pt", "it", "id", "vi", "th", "ar", "tr"}
TRANSLATION_TYPE_MAP = {
    "subtitle": "SubtitleTranslation",
    "voice": "VoiceTranslation",
    "face": "FacialTranslation",
}


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


def _normalize_translation_types(value: Any) -> list[str]:
    requested = [str(item).strip().lower() for item in value] if isinstance(value, list) else []
    normalized = ["subtitle"]
    if "voice" in requested:
        normalized.append("voice")
    if "face" in requested:
        normalized.append("face")
    if "face" in normalized and "voice" not in normalized:
        raise ValidationError("面容翻译必须同时开启语音翻译")
    return normalized


def _normalize_subtitle_config(value: Any) -> dict:
    raw = value if isinstance(value, dict) else {}
    config = {
        "isHardSubtitle": raw.get("isHardSubtitle") is True,
        "isEraseSource": raw.get("isEraseSource") is True,
    }
    if not config["isHardSubtitle"]:
        return config
    try:
        config.update({
            "fontSize": int(raw.get("fontSize")),
            "marginL": float(raw.get("marginL")),
            "marginR": float(raw.get("marginR")),
            "marginV": float(raw.get("marginV")),
            "showLines": int(raw.get("showLines")),
        })
    except (TypeError, ValueError) as error:
        raise ValidationError("硬字幕配置不完整") from error
    if not 1 <= config["fontSize"] <= 80:
        raise ValidationError("硬字幕字号必须在 1 到 80 之间")
    margins = [config["marginL"], config["marginR"], config["marginV"]]
    if not all(0 <= margin < 1 for margin in margins) or config["marginL"] + config["marginR"] >= 1:
        raise ValidationError("硬字幕边距配置无效")
    if config["showLines"] < 0:
        raise ValidationError("硬字幕最大行数不能小于 0")
    return config


class VodVideoTranslationService:
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
        source_language: str,
        target_language: str,
        translation_types: list[str] | None = None,
        subtitle_source: str = "ocr",
        subtitle_config: dict | None = None,
        space_name: str = "",
    ) -> dict:
        vid = vid.strip()
        source_language = source_language.strip().lower()
        target_language = target_language.strip().lower()
        subtitle_source = subtitle_source.strip().lower()
        resolved_space_name = space_name.strip() or settings.vod_space_name
        if not vid:
            raise ValidationError("缺少 VOD Vid")
        if not resolved_space_name:
            raise ValidationError("缺少 VOD 空间配置，请设置 VOLCENGINE_VOD_SPACE_NAME")
        if source_language not in SOURCE_LANGUAGES:
            raise ValidationError(f"不支持的源语言：{source_language or '空'}")
        if target_language not in TARGET_LANGUAGES:
            raise ValidationError(f"不支持的目标语言：{target_language or '空'}")
        if source_language == target_language:
            raise ValidationError("源语言和目标语言不能相同")
        if subtitle_source not in {"ocr", "asr"}:
            raise ValidationError(f"不支持的字幕来源：{subtitle_source}")
        normalized_types = _normalize_translation_types(translation_types)
        normalized_subtitle = _normalize_subtitle_config(subtitle_config)

        try:
            from volcenginesdkvod20250101.models import (
                OperatorConfigForSubmitAITranslationWorkflowInput,
                SubmitAITranslationWorkflowRequest,
                SubtitleConfigForSubmitAITranslationWorkflowInput,
                SubtitleRecognitionConfigForSubmitAITranslationWorkflowInput,
                TranslationConfigForSubmitAITranslationWorkflowInput,
            )
        except Exception as error:
            raise WorkerError("当前 VOD V2 SDK 缺少 AI 视频翻译模型，请升级 volcengine-python-sdk") from error

        subtitle_model = SubtitleConfigForSubmitAITranslationWorkflowInput(
            is_hard_subtitle=normalized_subtitle["isHardSubtitle"],
            is_erase_source=normalized_subtitle["isEraseSource"],
            font_size=normalized_subtitle.get("fontSize"),
            margin_l=normalized_subtitle.get("marginL"),
            margin_r=normalized_subtitle.get("marginR"),
            margin_v=normalized_subtitle.get("marginV"),
            show_lines=normalized_subtitle.get("showLines"),
        )
        request = SubmitAITranslationWorkflowRequest(
            space_name=resolved_space_name,
            vid=vid,
            translation_config=TranslationConfigForSubmitAITranslationWorkflowInput(
                source_language=source_language,
                target_language=target_language,
                translation_type_list=[TRANSLATION_TYPE_MAP[item] for item in normalized_types],
            ),
            operator_config=OperatorConfigForSubmitAITranslationWorkflowInput(
                subtitle_recognition_config=SubtitleRecognitionConfigForSubmitAITranslationWorkflowInput(
                    recognition_type=subtitle_source.upper(),
                    is_vision=False,
                ),
            ),
            subtitle_config=subtitle_model,
        )
        logger.info("vod video translation submit request", {
            "vid": vid,
            "spaceName": resolved_space_name,
            "sourceLanguage": source_language,
            "targetLanguage": target_language,
            "translationTypes": normalized_types,
            "subtitleSource": subtitle_source,
            "subtitleConfig": normalized_subtitle,
        })
        try:
            response = self._client().submit_ai_translation_workflow(request)
        except Exception as error:
            logger.error("vod video translation submit failed", {
                "vid": vid,
                "error": str(error),
                "traceback": traceback.format_exc(),
            })
            raise WorkerError(f"提交视频翻译任务失败：{error}") from error
        data = _model_to_dict(response)
        project_id = str(_first_value(data, [
            ("project_base_info", "project_id"),
            ("ProjectBaseInfo", "ProjectId"),
            ("result", "project_base_info", "project_id"),
            ("Result", "ProjectBaseInfo", "ProjectId"),
        ]) or "").strip()
        project_version = str(_first_value(data, [
            ("project_base_info", "project_version"),
            ("ProjectBaseInfo", "ProjectVersion"),
            ("result", "project_base_info", "project_version"),
            ("Result", "ProjectBaseInfo", "ProjectVersion"),
        ]) or "").strip()
        if not project_id:
            raise WorkerError("提交视频翻译任务成功但未返回 ProjectId")
        return {
            "ok": True,
            "projectId": project_id,
            "projectVersion": project_version,
            "vid": vid,
            "spaceName": resolved_space_name,
        }

    def get_project(self, project_id: str, space_name: str = "") -> dict:
        project_id = project_id.strip()
        resolved_space_name = space_name.strip() or settings.vod_space_name
        if not project_id:
            raise ValidationError("缺少视频翻译 ProjectId")
        if not resolved_space_name:
            raise ValidationError("缺少 VOD 空间配置，请设置 VOLCENGINE_VOD_SPACE_NAME")
        try:
            from volcenginesdkvod20250101.models import ListAITranslationProjectRequest
        except Exception as error:
            raise WorkerError("当前 VOD V2 SDK 缺少 AI 视频翻译查询模型，请升级 volcengine-python-sdk") from error
        try:
            response = self._client().list_ai_translation_project(ListAITranslationProjectRequest(
                space_name=resolved_space_name,
                project_id_or_title_filter=project_id,
                page_number=1,
                page_size="10",
            ))
        except Exception as error:
            logger.error("vod video translation query failed", {
                "projectId": project_id,
                "error": str(error),
                "traceback": traceback.format_exc(),
            })
            raise WorkerError(f"查询视频翻译任务失败：{error}") from error
        data = _model_to_dict(response)
        projects = _first_value(data, [
            ("projects",),
            ("Projects",),
            ("result", "projects"),
            ("Result", "Projects"),
        ])
        projects = projects if isinstance(projects, list) else []
        project = next((item for item in projects if isinstance(item, dict) and str(
            item.get("project_id") or item.get("ProjectId") or ""
        ).strip() == project_id), None)
        if project is None:
            raise WorkerError(f"未查询到视频翻译项目：{project_id}")
        status = str(project.get("status") or project.get("Status") or "").strip()
        output = project.get("output_video") or project.get("OutputVideo") or {}
        output = output if isinstance(output, dict) else {}
        duration_value = output.get("duration_second") if output.get("duration_second") is not None else output.get("DurationSecond")
        try:
            duration = float(duration_value) if duration_value is not None else None
        except (TypeError, ValueError):
            duration = None
        error_message = str(project.get("error_msg") or project.get("ErrorMsg") or "").strip()
        output_video = {
            "url": str(output.get("url") or output.get("Url") or "").strip(),
            "fileName": str(output.get("file_name") or output.get("FileName") or "").strip(),
            "vid": str(output.get("vid") or output.get("Vid") or "").strip(),
            "durationSecond": duration,
        }
        logger.info("vod video translation query response", {
            "projectId": project_id,
            "status": status,
            "outputVid": output_video["vid"],
            "hasOutputUrl": bool(output_video["url"]),
            "hasErrorMessage": bool(error_message),
        })
        return {
            "ok": True,
            "projectId": project_id,
            "status": status,
            "errorMessage": error_message,
            "outputVideo": output_video,
        }

from __future__ import annotations

import json
import os
import traceback
from typing import Any

from ai_worker.config import settings
from ai_worker.domain.errors import ValidationError, WorkerError
from ai_worker.infra import logger
from ai_worker.services.vod_upload_service import _credential_hint, _vod_credentials


UNDERSTANDING_AGENT_FALLBACKS = [
    {
        "key": "audio_expert",
        "name": "音频理解专家",
        "mode": "audio",
        "prompt": """# 角色 
你是专业的语音内容分析师。 

# 任务 
分析ASR文本和视频画面描述，判断每段语音内容的类型： 
1. 人物（character）：在视频画面中出现的人
2. 旁白（narration）：画面外的声音，未出现在视频画面中 
3. 口播（spoken）：面对镜头说话，语气直接，单人说话

# 输入 
ASR文本： {{PLACEHOLDER_ASR_RESULT}} 
视频画面描述： {{PLACEHOLDER_VIDEO_CLIP_RESULT}} 

# 分析规则 
1. 如只有单一说话人： 有人物出现在画面标记为"口播" - 无人物出现标记为"旁白" 
2. 如无法判断 → 标记为"旁白" 
3. 如果都是同一个声源，不需要标记人物角色
4. 不要把专家名一起输出
5. 严格按照声音的音色区分人物台词、旁白、口播, 如果有人物出现，但是人物没有说话，标记为旁白
# 输出 
人物台词/旁白/口播,时间不能出现小数点
如： 
1. 人物1：你好呀 ，时间：1s-4s。 
2. 人物2：嗯嗯你好 ，时间：5s-8s。 
3. 旁白：从前有座山，山上有座塔。时间：8s-12s。 
4. 口播：这是口播，时间：12s-16s。
""",
    },
    {
        "key": "video_expert",
        "name": "视频理解专家",
        "mode": "multimodal",
        "prompt": """# 角色
 你是专业的视频解析专家。

 # 任务1
分析输入视频，提取以下基础信息：
1. 视频内容：视频介绍/测评/推销的产品或服务

 # 任务2
分析视频画面，提取以下信息：
1. 场景描述：拍摄地点、环境布置、空间层次、光线氛围，出现的时间范围（单位秒）
2. 人物描述：用于复刻的人物描述，包含必要的人物外观、动作、表情、气质和声线（人物的声音描述），出现的时间范围（单位秒），不要包含口播

 # 任务3
分析视频的镜头语言：
1. 运镜方式：固定/推拉/摇移/跟拍/升降等
2. 景别变化：远景/全景/中景/近景/特写
3. 转场方式：硬切/淡入淡出/叠化/特效转场
4. 镜头节奏：快慢节奏、剪辑频率

 # 任务4
分析视频的视听元素：
1. 声音特效：BGM风格、音效类型、音量变化
2. 画面特效：滤镜、调色、动画、贴纸
3. 整体氛围：情绪基调、风格定位

 # 任务5
识别视频中展示的产品：
1. 产品类型：实物商品/虚拟服务/品牌logo
2. 产品特征：外观、颜色、包装、功能展示
3. 展示方式：特写/使用场景/对比展示
4. 产品信息：品牌、型号（如有文字识别）
5. 产品时间线：每个产品出现、被提及或承担画面重点的开始秒、结束秒
6. 规则：
    识别为产品的情况
    - 视频核心主题是介绍/测评/推销某个产品
    - 视频中提到了具体品牌名称和产品功能
    - 视频中明显植入了品牌广告或赞助
    - 台词中推荐了具体品牌/产品名（如"装修我推荐立邦漆"）
    不识别为产品的情况
    - 仅提到品类词，无具体品牌（如"装修建材哪里好"、"手机怎么选"）
    - 品牌名和产品名仅作为背景或者对比展示一闪而过，无任何介绍或详细描述的
    - 视频中提到了3个以上品牌/产品，那么就认为所有品牌/产品都不是产品
    - 视频中没有介绍/测评/推销具体品牌/产品
    - 提到的是通用概念或行业分类

# 视频分段描述文本
{{PLACEHOLDER_VIDEO_CLIP_RESULT}}

# 视频转音频文本
{{PLACEHOLDER_ASR_RESULT}}

 
 # 输出
只输出一个 JSON 对象，不要输出 Markdown 代码块，不要输出解释说明。
JSON 顶层 key 固定为 task1、task2、task3、task4、task5,
其他 key 必须全部使用中文内容名称，如：视频内容、场景描述、人物描述等。
如果视频内有多个人物/产品/场景，按照出场定义人物/产品/场景名字：人物1、人物2/产品1、产品2/场景1、场景2等。
task2 允许按“场景1、场景2、人物1、人物2”拆分，但每个场景对象内部只能包含场景描述字段，每个人物对象内部只能包含人物描述字段和人物声线字段；不要把人物1写入场景1，也不要把场景1写入人物1。
不要输出英文 key；时间请写成“时间范围：0s-30s”。
人物描述不要包含口播原文；口播只由音频理解专家负责。
场景和产品必须按出现时间、画面重点或语境拆分；例如肯德基、麦当劳、总结讲解应是不同条目，并各自带对应时间。
若视频内无相关内容，则不输出（比如：无角色或无产品）。
不要分析画中画/PIP，画中画由独立的画中画解析专家处理。
 """,
    },
    {
        "key": "picture_in_picture_expert",
        "name": "画中画解析专家",
        "mode": "multimodal",
        "prompt": """请根据视频分段描述和音频文本，识别视频中是否存在“画中画”或独立视觉叠加区域，并输出 JSON。

## 输入

视频分段描述文本：
{{PLACEHOLDER_VIDEO_CLIP_RESULT}}

视频转音频文本：
{{PLACEHOLDER_ASR_RESULT}}

## 识别目标

识别视频中是否存在以下结构：

1. 画中画视频
2. 图片叠加
3. 截图叠加
4. 手机或电脑录屏窗口
5. 左右分屏、上下分屏
6. 可用于复刻的视觉叠加层

画中画指：主画面之上或旁边出现的独立内容区域，有独立内容、位置、尺寸和持续时间。画中画可以是视频，也可以是图片。

## 可算作画中画

1. 主画面上叠加另一段视频。
2. 主画面上叠加商品图、人物图、案例图、素材图。
3. 主画面上叠加聊天截图、评论截图、网页截图、App 截图、订单截图。
4. 主画面上叠加手机录屏、电脑录屏、软件操作窗口。
5. 主画面上出现反应镜头、对比画面、补充说明窗口。
6. 左右分屏、上下分屏、前后对比、多画面并列。
7. 主播口播时，旁边或角落出现产品图、案例图、截图、教程步骤图。

## 不算作画中画

字幕、水印、单独品牌 Logo、小贴纸、emoji、箭头、红圈、标注线、装饰图形、滤镜、调色、普通动效、全屏背景图、拍摄场景中真实存在的手机/电脑/相框/海报/照片、一闪而过且无独立信息作用的小图标。

判断重点：它是否像后期叠加的独立内容层，而不是拍摄场景中本来存在的物体。

## type 取值

- `pip_video`：叠加另一段动态视频
- `pip_image`：叠加图片、商品图、人物图、案例图、素材图
- `screenshot_overlay`：叠加聊天截图、评论截图、网页截图、App 截图、订单截图
- `screen_recording`：叠加手机录屏、电脑录屏、软件操作窗口
- `split_screen`：左右分屏、上下分屏、前后对比、多画面并列
- `unknown`：疑似画中画但类型不确定

## 坐标和时间
请使用GROUNDING工具检测视频中的画中画区域，返回其边界框坐标和出现时间。
`x`、`y` 表示画中画左上角在原视频画布中的像素坐标。  
`width`、`height` 表示画中画宽高，单位像素。  
`startSecond`、`endSecond` 表示出现和结束秒数。  

坐标无法判断时填 `0`，并在 `summary` 说明。  
多个时间段、位置、尺寸或内容明显变化时，拆成多个 `items`。

## 输出要求

只输出严格 JSON，不输出解释说明。
JSON 必须能被标准 JSON.parse 直接解析：
- 所有 key 和字符串必须使用英文双引号，禁止使用单引号。
- 数字只能输出合法数字，不能输出 0.g、ZI、o 等非数字；无法判断时填 0。
- 禁止多余逗号、尾随逗号、注释、Markdown 代码块。
- 顶层 key 固定为 "pictureInPicture"，不要输出 "pictureInPicture'" 或其他变体。

有画中画时输出：

{
  "pictureInPicture": {
    "appeared": true,
    "items": [
      {
        "id": "pip_1",
        "type": "pip_image",
        "startSecond": 0,
        "endSecond": 3,
        "x": 720,
        "y": 120,
        "width": 320,
        "height": 180,
        "position": "右上角",
        "content": "画中画内展示的内容",
        "confidence": 0.86
      }
    ],
    "summary": "总结画中画类型、位置、作用和坐标估算情况"
  }
}

没有画中画时输出：

{
  "pictureInPicture": {
    "appeared": false,
    "items": [],
    "summary": "未出现画中画"
  }
}""",
    },
    {
        "key": "editing_expert",
        "name": "分镜脚本分析专家",
        "mode": "local",
        "prompt": """# 角色
你是专业的分镜脚本分析师。

# 任务
你需要基于音频理解专家、视频理解专家和画中画解析专家返回的内容，组织一个可执行的分镜复刻脚本，除了分镜信息不要返回多余的内容。

# 输出要求
1. 按镜头顺序输出。
2. 每个镜头包含：时间段、画面、人物/动作、台词/旁白、字幕/音效、复刻建议。
3. 如果输入信息不足，用“建议/可选”表达，不要编造明确事实。
""",
    },
]


def _sdk_diagnostics() -> dict:
    try:
        from importlib import metadata as importlib_metadata

        version = importlib_metadata.version("volcengine-python-sdk")
    except Exception:
        version = ""
    return {"package": "volcengine-python-sdk", "version": version}


def _value_at(data: Any, *path: str) -> Any:
    current = data
    for key in path:
        if isinstance(current, dict):
            current = current.get(key)
            continue
        current = getattr(current, key, None)
    return current


def _model_to_dict(value: Any) -> dict:
    if hasattr(value, "to_dict"):
        return value.to_dict()
    if isinstance(value, dict):
        return value
    return {}


def _find_token_field_summary(data: Any) -> dict[str, Any] | None:
    stack: list[tuple[Any, str, int]] = [(data, "$", 0)]
    while stack:
        value, path, depth = stack.pop()
        if depth > 8 or not isinstance(value, dict):
            continue
        input_tokens = _number(
            value.get("DoubaoInputTokens")
            or value.get("doubaoInputTokens")
            or value.get("doubao_input_tokens")
            or value.get("InputTokens")
            or value.get("inputTokens")
            or value.get("input_tokens")
            or value.get("doubao_text_input_tokens")
            or value.get("promptTokens")
            or value.get("prompt_tokens")
        )
        output_tokens = _number(
            value.get("DoubaoOutputTokens")
            or value.get("doubaoOutputTokens")
            or value.get("doubao_output_tokens")
            or value.get("OutputTokens")
            or value.get("outputTokens")
            or value.get("output_tokens")
            or value.get("doubao_text_output_tokens")
            or value.get("completionTokens")
            or value.get("completion_tokens")
        )
        total_tokens = _number(
            value.get("DoubaoTotalTokens")
            or value.get("doubaoTotalTokens")
            or value.get("doubao_total_tokens")
            or value.get("TotalTokens")
            or value.get("totalTokens")
            or value.get("total_tokens")
            or value.get("doubao_text_total_tokens")
            or value.get("tokenCount")
            or value.get("token_count")
        )
        if input_tokens or output_tokens or total_tokens:
            return {
                "path": path,
                "inputTokens": int(input_tokens),
                "outputTokens": int(output_tokens),
                "totalTokens": int(total_tokens),
                "keys": list(value.keys())[:24],
            }
        for key, entry in value.items():
            if isinstance(entry, dict):
                stack.append((entry, f"{path}.{key}", depth + 1))
            elif isinstance(entry, list):
                for index, item in enumerate(entry):
                    if isinstance(item, dict):
                        stack.append((item, f"{path}.{key}[{index}]", depth + 1))
    return None


def _try_parse_json(value: str) -> Any:
    text = value.strip()
    if not text:
        return None
    if text.startswith("```"):
        text = text.removeprefix("```json").removeprefix("```").removesuffix("```").strip()
    try:
        return json.loads(text)
    except Exception:
        start = text.find("{")
        end = text.rfind("}")
        if start >= 0 and end > start:
            try:
                return json.loads(text[start:end + 1])
            except Exception:
                return None
    return None


def _first_record_at(data: Any, paths: list[tuple[str, ...]]) -> dict:
    for path in paths:
        value = _value_at(data, *path)
        if isinstance(value, dict):
            return value
    return {}


def _number(value: Any) -> float:
    try:
        number = float(value)
        return number if number == number and number >= 0 else 0
    except Exception:
        return 0


def _bool_from_value(value: Any, default: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        text = value.strip().lower()
        if text in ("true", "yes", "1", "是", "有", "出现"):
            return True
        if text in ("false", "no", "0", "否", "无", "未出现", "没有"):
            return False
    return default


def _normalize_pip_item(item: dict, index: int) -> dict:
    start = _number(item.get("startSecond") or item.get("start") or item.get("time") or 0)
    end = _number(item.get("endSecond") or item.get("end") or 0)
    if end and end < start:
        end = start
    return {
        "id": str(item.get("id") or f"pip_{index + 1}"),
        "type": str(item.get("type") or "unknown"),
        "startSecond": start,
        "endSecond": end,
        "position": str(item.get("position") or ""),
        "content": str(item.get("content") or item.get("description") or ""),
        "confidence": _number(item.get("confidence")),
    }


def _picture_in_picture_from_content(content: str) -> dict:
    parsed = _try_parse_json(content)
    if not isinstance(parsed, dict):
        return {"appeared": False, "items": [], "summary": ""}
    pip = _first_record_at(parsed, [("pictureInPicture",)])
    items = pip.get("items") if isinstance(pip, dict) else []
    normalized_items = [
        _normalize_pip_item(item, index)
        for index, item in enumerate(items)
        if isinstance(item, dict)
    ] if isinstance(items, list) else []
    appeared = _bool_from_value(pip.get("appeared"), False) if isinstance(pip, dict) else bool(normalized_items)
    if not appeared and normalized_items:
        appeared = True
    return {
        "appeared": appeared,
        "items": normalized_items,
        "summary": str(pip.get("summary") or "") if isinstance(pip, dict) else "",
    }


def _normalize_roles(raw_roles: Any) -> list[dict]:
    if not isinstance(raw_roles, list) or not raw_roles:
        logger.warning("vod understanding roles missing, using fallback agents", {
            "rawRolesType": type(raw_roles).__name__,
            "fallbackCount": len(UNDERSTANDING_AGENT_FALLBACKS),
        })
        return UNDERSTANDING_AGENT_FALLBACKS
    roles: list[dict] = []
    for index, item in enumerate(raw_roles):
        if not isinstance(item, dict):
            continue
        key = str(item.get("key") or f"role_{index + 1}").strip()
        name = str(item.get("name") or key).strip()
        mode = str(item.get("mode") or "multimodal").strip()
        prompt = str(item.get("prompt") or "").strip()
        if key and name and prompt:
            roles.append({"key": key, "name": name, "mode": mode, "prompt": prompt})
    if not roles:
        logger.warning("vod understanding roles invalid, using fallback agents", {
            "rawRolesCount": len(raw_roles),
            "fallbackCount": len(UNDERSTANDING_AGENT_FALLBACKS),
        })
        return UNDERSTANDING_AGENT_FALLBACKS
    return roles


def _sdk_roles(roles: list[dict]) -> list[dict]:
    runnable = [role for role in roles if role.get("mode") in ("audio", "multimodal")]
    skipped = [role.get("key") for role in roles if role.get("mode") not in ("audio", "multimodal")]
    if skipped:
        logger.info("vod understanding skipped non-sdk roles", {"roles": skipped})
    return runnable


def _vision_tools_for_role(role: dict) -> list[dict] | None:
    if role.get("key") != "picture_in_picture_expert":
        return None
    return [{"type": "grounding"}]


class VodUnderstandingService:
    def __init__(self):
        self._local_video_by_run_id: dict[str, str] = {}
        self._role_by_run_id: dict[str, str] = {}

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
            "ok": bool(ak and sk),
            "spaceName": settings.vod_space_name,
            "region": settings.vod_region or "cn-north-1",
            "sdk": _sdk_diagnostics(),
            "akSource": ak_source,
            "skSource": sk_source,
            "ak": _credential_hint(ak),
            "sk": _credential_hint(sk),
            "modelConfig": {
                "hasDoubaoEndpoint": bool(settings.vod_doubao_endpoint),
                "hasAsrAppId": bool(settings.vod_asr_app_id),
                "asrAppType": settings.vod_asr_app_type,
            },
        }

    def agents(self) -> dict:
        return {
            "ok": True,
            "agents": UNDERSTANDING_AGENT_FALLBACKS,
        }

    def start(self, vid: str, roles: Any = None, space_name: str = "", file_path: str = "") -> dict:
        vid = vid.strip()
        if not vid:
            raise ValidationError("缺少 VOD Vid")
        if not settings.vod_space_name and not space_name:
            raise ValidationError("缺少 VOD 空间配置，请设置 VOLCENGINE_VOD_SPACE_NAME")
        if not settings.vod_asr_app_id:
            raise ValidationError("缺少长视频理解 ASR AppId，请设置 VOLCENGINE_VOD_ASR_APP_ID")
        if not settings.vod_doubao_endpoint:
            raise ValidationError("缺少豆包 Endpoint，请设置 VOLCENGINE_VOD_DOUBAO_ENDPOINT")

        api = self._client()
        normalized_roles = _sdk_roles(_normalize_roles(roles))
        logger.info("vod understanding normalized roles", {
            "roleCount": len(normalized_roles),
            "roles": [
                {
                    "key": role.get("key"),
                    "name": role.get("name"),
                    "mode": role.get("mode"),
                    "promptPreview": str(role.get("prompt") or "")[:160],
                }
                for role in normalized_roles
            ],
        })
        executions = []
        for role in normalized_roles:
            execution = self._start_role(api, vid, role, space_name or settings.vod_space_name)
            self._role_by_run_id[execution["runId"]] = execution["role"]
            if file_path and os.path.exists(file_path):
                self._local_video_by_run_id[execution["runId"]] = file_path
            executions.append(execution)
        return {
            "ok": True,
            "vid": vid,
            "spaceName": space_name or settings.vod_space_name,
            "executions": executions,
            "pipExtraction": {
                "hasLocalVideo": bool(file_path and os.path.exists(file_path)),
                "requiresCompletedVideoExpert": False,
                "requiresCompletedPictureInPictureExpert": True,
            },
        }

    def _start_role(self, api: Any, vid: str, role: dict, space_name: str) -> dict:
        try:
            from volcenginesdkvod20250101.models import (
                ConvertModelForStartExecutionInput,
                ConvertOperationForStartExecutionInput,
                InputForStartExecutionInput,
                SnapshotParamForStartExecutionInput,
                StartExecutionRequest,
                TaskForStartExecutionInput,
                VisionForStartExecutionInput,
            )
        except Exception as error:
            raise WorkerError("火山引擎 VOD V2 SDK 缺少长视频理解模型定义") from error

        is_multimodal = role["mode"] == "multimodal"

        model = ConvertModelForStartExecutionInput(
            doubao_text_endpoint=settings.vod_doubao_endpoint,
            doubao_vision_endpoint=settings.vod_doubao_endpoint,
            asr_app_id=settings.vod_asr_app_id,
            asr_app_type=settings.vod_asr_app_type,
        )
        need_asr_speaker = settings.vod_asr_app_type == "volc.bigasr.auc_turb"
        vision = VisionForStartExecutionInput(
            prompt=role["prompt"],
            model=model,
            need_asr_speaker=True if need_asr_speaker else None,
            snapshot_param=SnapshotParamForStartExecutionInput(
                resolution=settings.vod_understanding_snapshot_resolution,
                fps=settings.vod_understanding_snapshot_fps,
            ) if is_multimodal else None,
        )
        vision_tools = _vision_tools_for_role(role)
        if vision_tools:
            setattr(vision, "tools", vision_tools)
        request = StartExecutionRequest(
            space_name=space_name,
            input=InputForStartExecutionInput(type="Vid", vid=vid),
            operation=ConvertOperationForStartExecutionInput(
                type="Task",
                task=TaskForStartExecutionInput(type="Vision", vision=vision),
            ),
        )
        logger.info("vod understanding start execution request", {
            "role": role["key"],
            "roleName": role["name"],
            "mode": role["mode"],
            "vid": vid,
            "spaceName": space_name,
            "promptChars": len(role["prompt"]),
            "model": {
                "doubaoTextEndpoint": settings.vod_doubao_endpoint,
                "doubaoVisionEndpoint": settings.vod_doubao_endpoint,
                "asrAppId": settings.vod_asr_app_id,
                "asrAppType": settings.vod_asr_app_type,
                "needAsrSpeaker": need_asr_speaker,
                "hasSnapshotParam": is_multimodal,
                "hasTools": bool(vision_tools),
                "tools": vision_tools or [],
            },
            "sdk": _sdk_diagnostics(),
        })
        try:
            response = api.start_execution(request)
        except Exception as error:
            logger.error("vod understanding start execution failed", {
                "role": role["key"],
                "error": str(error),
                "traceback": traceback.format_exc(),
            })
            raise WorkerError(f"提交长视频理解任务失败：{role['name']}：{error}") from error
        data = _model_to_dict(response)
        run_id = str(data.get("run_id") or data.get("RunId") or getattr(response, "run_id", "") or "").strip()
        if not run_id:
            raise WorkerError(f"提交长视频理解任务成功但未返回 RunId：{role['name']}")
        return {
            "role": role["key"],
            "roleName": role["name"],
            "mode": role["mode"],
            "runId": run_id,
            "prompt": role["prompt"],
            "raw": data,
        }

    def get_execution(self, run_id: str) -> dict:
        run_id = run_id.strip()
        if not run_id:
            raise ValidationError("缺少 RunId")
        try:
            from volcenginesdkvod20250101.models import GetExecutionRequest
        except Exception as error:
            raise WorkerError("火山引擎 VOD V2 SDK 缺少 GetExecution 模型定义") from error

        api = self._client()
        try:
            response = api.get_execution(GetExecutionRequest(run_id=run_id))
        except Exception as error:
            logger.error("vod understanding get execution failed", {
                "runId": run_id,
                "error": str(error),
                "traceback": traceback.format_exc(),
            })
            raise WorkerError(f"查询长视频理解任务失败：{error}") from error
        data = _model_to_dict(response)
        status = str(data.get("status") or data.get("Status") or getattr(response, "status", "") or "")
        content = (
            _value_at(data, "output", "task", "vision", "content")
            or _value_at(data, "Output", "Task", "Vision", "Content")
            or ""
        )
        vision_record = _first_record_at(data, [
            ("output", "task", "vision"),
            ("Output", "Task", "Vision"),
        ])
        model_record = _first_record_at(data, [
            ("output", "task", "vision", "model"),
            ("Output", "Task", "Vision", "Model"),
        ])
        token_field_summary = _find_token_field_summary(data)
        logger.info("vod understanding get execution response summary", {
            "runId": run_id,
            "status": status,
            "topLevelKeys": list(data.keys())[:24],
            "visionKeys": list(vision_record.keys())[:24],
            "modelKeys": list(model_record.keys())[:24],
            "contentChars": len(str(content)),
            "tokenFieldSummary": token_field_summary,
        })
        role = self._role_by_run_id.get(run_id, "")
        picture_in_picture = (
            _picture_in_picture_from_content(str(content))
            if role in ("picture_in_picture_expert", "")
            else {"appeared": False, "items": [], "summary": ""}
        )
        pip_assets = {}
        return {
            "ok": True,
            "runId": run_id,
            "status": status,
            "content": content,
            "pictureInPicture": picture_in_picture,
            "pipAssets": pip_assets,
            "raw": data,
        }

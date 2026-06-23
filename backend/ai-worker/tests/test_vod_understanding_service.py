import sys
import unittest
from types import ModuleType, SimpleNamespace
from unittest.mock import patch

from ai_worker.services import vod_understanding_service as service_module
from ai_worker.services.vod_understanding_service import VodUnderstandingService


def install_fake_get_execution_request():
    module = ModuleType("volcenginesdkvod20250101.models")
    module.GetExecutionRequest = SimpleNamespace
    sys.modules["volcenginesdkvod20250101.models"] = module


def install_fake_start_execution_models():
    module = ModuleType("volcenginesdkvod20250101.models")
    for name in [
        "ConvertModelForStartExecutionInput",
        "ConvertOperationForStartExecutionInput",
        "InputForStartExecutionInput",
        "SnapshotParamForStartExecutionInput",
        "StartExecutionRequest",
        "TaskForStartExecutionInput",
        "VisionForStartExecutionInput",
    ]:
        setattr(module, name, SimpleNamespace)
    sys.modules["volcenginesdkvod20250101.models"] = module


class VodUnderstandingServiceTest(unittest.TestCase):
    def test_fallback_roles_include_standalone_picture_in_picture_expert(self):
        agents = {agent["key"]: agent for agent in service_module.UNDERSTANDING_AGENT_FALLBACKS}

        self.assertIn("picture_in_picture_expert", agents)
        self.assertEqual(agents["picture_in_picture_expert"]["mode"], "multimodal")
        self.assertIn("不要分析画中画/PIP", agents["video_expert"]["prompt"])
        self.assertIn("开始秒、结束秒、口播", agents["video_expert"]["prompt"])
        self.assertIn("严禁输出 startSecond、endSecond、spokenCue、speckCue 等英文 key", agents["video_expert"]["prompt"])
        self.assertIn("画中画解析专家", agents["picture_in_picture_expert"]["name"])
        self.assertIn("请根据视频分段描述和音频文本，识别视频中是否存在“画中画”或独立视觉叠加区域，并输出 JSON。", agents["picture_in_picture_expert"]["prompt"])
        self.assertIn("## 识别目标", agents["picture_in_picture_expert"]["prompt"])
        self.assertIn("## type 取值", agents["picture_in_picture_expert"]["prompt"])
        self.assertIn('"summary": "未出现画中画"', agents["picture_in_picture_expert"]["prompt"])

    def test_sdk_roles_keeps_picture_in_picture_expert_and_skips_local(self):
        roles = service_module._sdk_roles(service_module.UNDERSTANDING_AGENT_FALLBACKS)

        self.assertEqual([role["key"] for role in roles], [
            "audio_expert",
            "video_expert",
            "picture_in_picture_expert",
        ])

    def test_start_role_enables_grounding_tools_only_for_picture_in_picture_expert(self):
        class FakeApi:
            def __init__(self):
                self.requests = []

            def start_execution(self, request):
                self.requests.append(request)
                return {"run_id": f"run_{len(self.requests)}"}

        install_fake_start_execution_models()
        api = FakeApi()
        service = VodUnderstandingService()
        pip_role = {
            "key": "picture_in_picture_expert",
            "name": "画中画解析专家",
            "mode": "multimodal",
            "prompt": "pip prompt",
        }
        video_role = {
            "key": "video_expert",
            "name": "视频理解专家",
            "mode": "multimodal",
            "prompt": "video prompt",
        }

        service._start_role(api, "vid_1", pip_role, "space")
        service._start_role(api, "vid_1", video_role, "space")

        self.assertEqual(api.requests[0].operation.task.vision.tools, [{"type": "grounding"}])
        self.assertFalse(hasattr(api.requests[1].operation.task.vision, "tools"))

    def test_get_execution_extracts_pip_only_for_picture_in_picture_role(self):
        class FakeApi:
            def get_execution(self, request):
                return {
                    "status": "success",
                    "output": {
                        "task": {
                            "vision": {
                                "content": '{"pictureInPicture":{"appeared":true,"items":[{"type":"screenshot_overlay","confidence":0.86,"startSecond":1,"endSecond":2,"position":"右上角","content":"评论截图"}],"summary":"出现评论截图画中画"}}'
                            }
                        }
                    },
                }

        install_fake_get_execution_request()
        with patch.object(VodUnderstandingService, "_client", lambda self: FakeApi()):
            service = VodUnderstandingService()
            service._role_by_run_id["pip_run"] = "picture_in_picture_expert"
            service._local_video_by_run_id["pip_run"] = "/tmp/source.mp4"

            result = service.get_execution("pip_run")

        self.assertTrue(result["pictureInPicture"]["appeared"])
        self.assertEqual(result["pictureInPicture"]["items"][0]["type"], "screenshot_overlay")
        self.assertEqual(result["pictureInPicture"]["items"][0]["confidence"], 0.86)
        self.assertEqual(result["pictureInPicture"]["items"][0]["position"], "右上角")
        self.assertEqual(result["pictureInPicture"]["items"][0]["content"], "评论截图")
        self.assertEqual(result["pipAssets"], {})
        self.assertNotIn("width", result["pictureInPicture"]["items"][0])
        self.assertNotIn("height", result["pictureInPicture"]["items"][0])
        self.assertNotIn("x", result["pictureInPicture"]["items"][0])
        self.assertNotIn("y", result["pictureInPicture"]["items"][0])

    def test_get_execution_does_not_extract_pip_assets_from_legacy_geometry(self):
        class FakeApi:
            def get_execution(self, request):
                return {
                    "status": "success",
                    "output": {
                        "task": {
                            "vision": {
                                "content": '{"pictureInPicture":{"appeared":true,"items":[{"id":"pip_1","type":"screenshot_overlay","startSecond":1,"endSecond":2,"content":"评论截图","width":100,"height":50,"x":10,"y":20}],"summary":"legacy geometry"}}'
                            }
                        }
                    },
                }

        install_fake_get_execution_request()
        with patch.object(VodUnderstandingService, "_client", lambda self: FakeApi()):
            service = VodUnderstandingService()
            service._role_by_run_id["pip_run"] = "picture_in_picture_expert"
            service._local_video_by_run_id["pip_run"] = "/tmp/source.mp4"

            result = service.get_execution("pip_run")

        self.assertEqual(result["pipAssets"], {})

    def test_picture_in_picture_parser_ignores_legacy_task2_shape(self):
        result = service_module._picture_in_picture_from_content(
            '{"task2":{"content":{"pictureInPicture":{"appeared":true,"items":[{"startSecond":1}],"summary":"legacy"}}}}'
        )

        self.assertEqual(result, {"appeared": False, "items": [], "summary": ""})

    def test_get_execution_does_not_extract_pip_from_video_expert(self):
        class FakeApi:
            def get_execution(self, request):
                return {
                    "status": "success",
                    "output": {
                        "task": {
                            "vision": {
                                "content": '{"pictureInPicture":{"appeared":true,"items":[{"startSecond":1}],"summary":"旧视频专家输出"}}'
                            }
                        }
                    },
                }

        install_fake_get_execution_request()
        with patch.object(VodUnderstandingService, "_client", lambda self: FakeApi()):
            service = VodUnderstandingService()
            service._role_by_run_id["video_run"] = "video_expert"

            result = service.get_execution("video_run")

        self.assertEqual(result["pictureInPicture"], {"appeared": False, "items": [], "summary": ""})
        self.assertEqual(result["pipAssets"], {})

    def test_find_token_field_summary_supports_snake_case_doubao_fields(self):
        summary = service_module._find_token_field_summary({
            "output": {
                "task": {
                    "vision": {
                        "model": {
                            "doubao_input_tokens": 7037,
                            "doubao_output_tokens": 574,
                            "doubao_total_tokens": 7611,
                        }
                    }
                }
            }
        })

        self.assertEqual(summary, {
            "path": "$.output.task.vision.model",
            "inputTokens": 7037,
            "outputTokens": 574,
            "totalTokens": 7611,
            "keys": [
                "doubao_input_tokens",
                "doubao_output_tokens",
                "doubao_total_tokens",
            ],
        })


if __name__ == "__main__":
    unittest.main()

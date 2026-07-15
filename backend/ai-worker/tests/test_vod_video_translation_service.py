import sys
import unittest
from types import ModuleType, SimpleNamespace
from unittest.mock import patch

from ai_worker.services.vod_video_translation_service import VodVideoTranslationService


def install_fake_models():
    module = ModuleType("volcenginesdkvod20250101.models")
    for name in [
        "ListAITranslationProjectRequest",
        "OperatorConfigForSubmitAITranslationWorkflowInput",
        "SubmitAITranslationWorkflowRequest",
        "SubtitleConfigForSubmitAITranslationWorkflowInput",
        "SubtitleRecognitionConfigForSubmitAITranslationWorkflowInput",
        "TranslationConfigForSubmitAITranslationWorkflowInput",
    ]:
        setattr(module, name, SimpleNamespace)
    sys.modules["volcenginesdkvod20250101.models"] = module


class FakeApi:
    def __init__(self, submit_response=None, list_response=None):
        self.requests = []
        self.submit_response = submit_response or {
            "project_base_info": {
                "project_id": "project_1",
                "project_version": "version_1",
            },
        }
        self.list_response = list_response or {"projects": []}

    def submit_ai_translation_workflow(self, request):
        self.requests.append(request)
        return self.submit_response

    def list_ai_translation_project(self, request):
        self.requests.append(request)
        return self.list_response


class VodVideoTranslationServiceTest(unittest.TestCase):
    def setUp(self):
        install_fake_models()

    def test_start_maps_full_translation_and_hard_subtitle_config(self):
        api = FakeApi()
        with patch.object(VodVideoTranslationService, "_client", lambda self: api):
            result = VodVideoTranslationService().start(
                vid="vid_1",
                source_language="zh",
                target_language="en",
                translation_types=["subtitle", "voice", "face"],
                subtitle_source="ocr",
                subtitle_config={
                    "isHardSubtitle": True,
                    "isEraseSource": True,
                    "fontSize": 24,
                    "marginL": 0.1,
                    "marginR": 0.1,
                    "marginV": 0.05,
                    "showLines": 2,
                },
                space_name="space_1",
            )

        request = api.requests[0]
        self.assertEqual(result["projectId"], "project_1")
        self.assertEqual(request.space_name, "space_1")
        self.assertEqual(request.vid, "vid_1")
        self.assertEqual(request.translation_config.translation_type_list, [
            "SubtitleTranslation",
            "VoiceTranslation",
            "FacialTranslation",
        ])
        self.assertEqual(request.operator_config.subtitle_recognition_config.recognition_type, "OCR")
        self.assertFalse(request.operator_config.subtitle_recognition_config.is_vision)
        self.assertTrue(request.subtitle_config.is_hard_subtitle)
        self.assertTrue(request.subtitle_config.is_erase_source)
        self.assertEqual(request.subtitle_config.font_size, 24)
        self.assertEqual(request.subtitle_config.margin_l, 0.1)
        self.assertEqual(request.subtitle_config.margin_r, 0.1)
        self.assertEqual(request.subtitle_config.margin_v, 0.05)
        self.assertEqual(request.subtitle_config.show_lines, 2)

    def test_start_maps_asr_and_subtitle_only(self):
        api = FakeApi()
        with patch.object(VodVideoTranslationService, "_client", lambda self: api):
            VodVideoTranslationService().start(
                vid="vid_2",
                source_language="en",
                target_language="ja",
                translation_types=["subtitle"],
                subtitle_source="asr",
                subtitle_config={
                    "isHardSubtitle": False,
                    "isEraseSource": False,
                },
                space_name="space_1",
            )

        request = api.requests[0]
        self.assertEqual(request.translation_config.translation_type_list, ["SubtitleTranslation"])
        self.assertEqual(request.operator_config.subtitle_recognition_config.recognition_type, "ASR")
        self.assertFalse(request.subtitle_config.is_hard_subtitle)
        self.assertIsNone(request.subtitle_config.font_size)

    def test_get_project_extracts_completed_output_video(self):
        api = FakeApi(list_response={
            "projects": [{
                "project_id": "project_3",
                "status": "ProcessSucceed",
                "output_video": {
                    "url": "https://example.com/translated.mp4",
                    "file_name": "translated/output.mp4",
                    "vid": "output_vid_3",
                    "duration_second": 61.25,
                },
            }],
        })
        with patch.object(VodVideoTranslationService, "_client", lambda self: api):
            result = VodVideoTranslationService().get_project("project_3", "space_1")

        request = api.requests[0]
        self.assertEqual(request.project_id_or_title_filter, "project_3")
        self.assertEqual(result["status"], "ProcessSucceed")
        self.assertEqual(result["outputVideo"]["url"], "https://example.com/translated.mp4")
        self.assertEqual(result["outputVideo"]["vid"], "output_vid_3")
        self.assertEqual(result["outputVideo"]["durationSecond"], 61.25)


if __name__ == "__main__":
    unittest.main()

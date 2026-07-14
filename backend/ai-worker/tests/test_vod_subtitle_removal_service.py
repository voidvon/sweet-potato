import sys
import unittest
from types import ModuleType, SimpleNamespace
from unittest.mock import patch

from ai_worker.services.vod_subtitle_removal_service import VodSubtitleRemovalService


def install_fake_models():
    module = ModuleType("volcenginesdkvod20250101.models")
    for name in [
        "AutoForStartExecutionInput",
        "ClipFilterForStartExecutionInput",
        "ClipForStartExecutionInput",
        "ConvertOperationForStartExecutionInput",
        "EraseForStartExecutionInput",
        "EraseOptionForStartExecutionInput",
        "GetExecutionRequest",
        "InputForStartExecutionInput",
        "LocationForStartExecutionInput",
        "ManualForStartExecutionInput",
        "RatioLocationForStartExecutionInput",
        "StartExecutionRequest",
        "SubtitleFilterForStartExecutionInput",
        "TaskForStartExecutionInput",
    ]:
        setattr(module, name, SimpleNamespace)
    sys.modules["volcenginesdkvod20250101.models"] = module


class FakeApi:
    def __init__(self, response=None):
        self.requests = []
        self.response = response or {"run_id": "run_erase_1"}

    def start_execution(self, request):
        self.requests.append(request)
        return self.response

    def get_execution(self, request):
        self.requests.append(request)
        return self.response


class VodSubtitleRemovalServiceTest(unittest.TestCase):
    def setUp(self):
        install_fake_models()

    def test_auto_mode_builds_subtitle_ocr_request(self):
        api = FakeApi()
        with patch.object(VodSubtitleRemovalService, "_client", lambda self: api):
            result = VodSubtitleRemovalService().start(
                vid="vid_1",
                mode="auto",
                content_type="subtitle",
                space_name="space_1",
            )

        erase = api.requests[0].operation.task.erase
        self.assertEqual(result["runId"], "run_erase_1")
        self.assertEqual(erase.mode, "Auto")
        self.assertEqual(erase.auto.type, "Subtitle")
        self.assertIsNotNone(erase.auto.subtitle_filter)
        self.assertIsNone(erase.auto.locations)
        self.assertIsNone(erase.manual)
        self.assertTrue(erase.new_vid)

    def test_auto_region_maps_ratio_location_and_selected_clip(self):
        api = FakeApi()
        with patch.object(VodSubtitleRemovalService, "_client", lambda self: api):
            VodSubtitleRemovalService().start(
                vid="vid_2",
                mode="auto_region",
                content_type="text",
                locations=[{
                    "topLeftX": 0.1,
                    "topLeftY": 0.6,
                    "bottomRightX": 0.9,
                    "bottomRightY": 0.95,
                }],
                clip_filter={"mode": "selected", "start": 10, "end": 60},
                space_name="space_1",
            )

        erase = api.requests[0].operation.task.erase
        ratio = erase.auto.locations[0].ratio_location
        self.assertEqual(erase.auto.type, "Text")
        self.assertEqual(ratio.top_left_x, 0.1)
        self.assertEqual(ratio.top_left_y, 0.6)
        self.assertEqual(ratio.bottom_right_x, 0.9)
        self.assertEqual(ratio.bottom_right_y, 0.95)
        self.assertEqual(erase.erase_option.clip_filter.mode, "Selected")
        self.assertEqual(erase.erase_option.clip_filter.clips[0].start, 10)
        self.assertEqual(erase.erase_option.clip_filter.clips[0].end, 60)

    def test_manual_mode_uses_manual_locations_without_auto(self):
        api = FakeApi()
        with patch.object(VodSubtitleRemovalService, "_client", lambda self: api):
            VodSubtitleRemovalService().start(
                vid="vid_3",
                mode="manual",
                locations=[{
                    "topLeftX": 0.05,
                    "topLeftY": 0.7,
                    "bottomRightX": 0.95,
                    "bottomRightY": 0.98,
                }],
                space_name="space_1",
            )

        erase = api.requests[0].operation.task.erase
        self.assertEqual(erase.mode, "Manual")
        self.assertEqual(len(erase.manual.locations), 1)
        self.assertIsNone(erase.auto)

    def test_selected_mode_maps_multiple_clips(self):
        api = FakeApi()
        with patch.object(VodSubtitleRemovalService, "_client", lambda self: api):
            VodSubtitleRemovalService().start(
                vid="vid_4",
                mode="auto",
                clip_filter={
                    "mode": "selected",
                    "clips": [
                        {"start": 2, "end": 8.5},
                        {"start": 15, "end": 24},
                    ],
                },
                space_name="space_1",
            )

        clips = api.requests[0].operation.task.erase.erase_option.clip_filter.clips
        self.assertEqual(len(clips), 2)
        self.assertEqual(clips[0].start, 2)
        self.assertEqual(clips[0].end, 8.5)
        self.assertEqual(clips[1].start, 15)
        self.assertEqual(clips[1].end, 24)

    def test_get_execution_extracts_output_file(self):
        api = FakeApi({
            "status": "Success",
            "output": {
                "task": {
                    "erase": {
                        "duration": 57.099,
                        "file": {
                            "file_name": "output/subtitle-erased.mp4",
                            "vid": "output_vid_1",
                        },
                    }
                }
            },
        })
        with patch.object(VodSubtitleRemovalService, "_client", lambda self: api):
            result = VodSubtitleRemovalService().get_execution("run_1")

        self.assertEqual(result["status"], "Success")
        self.assertEqual(result["fileName"], "output/subtitle-erased.mp4")
        self.assertEqual(result["vid"], "output_vid_1")
        self.assertEqual(result["duration"], 57.099)


if __name__ == "__main__":
    unittest.main()

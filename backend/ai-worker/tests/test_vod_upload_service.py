import unittest

from ai_worker.services.vod_upload_service import _safe_vod_file_name


class VodUploadServiceTest(unittest.TestCase):
    def test_safe_vod_file_name_uses_unique_local_name_for_chinese_titles(self):
        first = _safe_vod_file_name(
            "纯口播.mp4",
            ".mp4",
            "1781604578732-video-remake-asset.mp4",
        )
        second = _safe_vod_file_name(
            "纯旁白.mp4",
            ".mp4",
            "1781605613123-video-remake-asset.mp4",
        )

        self.assertEqual(first, "viral-replication/1781604578732-video-remake-asset.mp4")
        self.assertEqual(second, "viral-replication/1781605613123-video-remake-asset.mp4")
        self.assertNotEqual(first, second)

    def test_safe_vod_file_name_preserves_readable_ascii_part(self):
        result = _safe_vod_file_name(
            "clip.mp4",
            ".mp4",
            "1781605613123-video-remake-asset.mp4",
        )

        self.assertEqual(result, "viral-replication/clip-1781605613123-video-remake-asset.mp4")


if __name__ == "__main__":
    unittest.main()

import unittest

from ai_worker.wechat_automation.uia import append_log


class WechatAutomationUiaTest(unittest.TestCase):
    def test_append_log_supports_structured_code_and_details(self):
        logs = []

        append_log(
            logs,
            "info",
            "已找到微信窗口: 微信",
            code="window_found",
            details={"windowName": "微信"},
        )

        self.assertEqual(logs, [{
            "level": "info",
            "message": "已找到微信窗口: 微信",
            "code": "window_found",
            "details": {"windowName": "微信"},
        }])


if __name__ == "__main__":
    unittest.main()

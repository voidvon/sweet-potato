import unittest

from wechat_automation.uia import append_log, click_control, physical_click_rect_center


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

    def test_click_control_prefers_rect_center_when_requested(self):
        events = []

        class FakeRect:
            left = 100
            top = 200
            right = 140
            bottom = 240

        class FakeControl:
            BoundingRectangle = FakeRect()

            def SetFocus(self):
                events.append("focus")

            def Click(self, simulateMove: bool = False):
                events.append(("control_click", simulateMove))

        class FakeAuto:
            def Click(self, x: int, y: int):
                events.append(("auto_click", x, y))

        diagnostics = click_control(FakeAuto(), FakeControl(), prefer_rect_center=True)

        self.assertEqual(events, ["focus", ("auto_click", 120, 220)])
        self.assertEqual(diagnostics["method"], "auto.Click(rect_center)")
        self.assertEqual(diagnostics["center"], (120, 220))

    def test_physical_click_rect_center_returns_diagnostics(self):
        class FakeRect:
            left = 100
            top = 200
            right = 140
            bottom = 240

        class FakeControl:
            BoundingRectangle = FakeRect()

        diagnostics = physical_click_rect_center(object(), FakeControl())

        self.assertEqual(diagnostics["method"], "win32.mouse_event(left_down_up)")
        self.assertEqual(diagnostics["center"], (120, 220))
        self.assertIn("errors", diagnostics)


if __name__ == "__main__":
    unittest.main()

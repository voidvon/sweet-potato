import unittest

from ai_worker.wechat_automation.constants import ADD_FRIEND_NAME, QUICK_ACTION_NAME, REQUEST_LABEL_NAME
from ai_worker.wechat_automation.selectors import (
    build_menu_probe_region,
    find_add_friend_entry,
    find_plus_button,
    find_request_greeting_editor,
)


class FakeRect:
    def __init__(self, left: int, top: int, right: int, bottom: int):
        self.left = left
        self.top = top
        self.right = right
        self.bottom = bottom


class FakeControl:
    def __init__(
        self,
        *,
        name: str = "",
        control_type: str = "PaneControl",
        class_name: str = "",
        rect: tuple[int, int, int, int] | None = None,
        children: list["FakeControl"] | None = None,
    ):
        self.Name = name
        self.ControlTypeName = control_type
        self.ClassName = class_name
        self.AutomationId = ""
        self._rect = FakeRect(*rect) if rect is not None else None
        self._children = children or []
        self.clicked = False

    @property
    def BoundingRectangle(self):
        return self._rect

    def Exists(self, timeout: float = 0.0):
        return True

    def GetChildren(self):
        return list(self._children)

    def Click(self, simulateMove: bool = False):
        self.clicked = True

    def _find_first(self, control_type: str, name: str | None, search_depth: int):
        queue: list[tuple["FakeControl", int]] = [(child, 1) for child in self._children]
        while queue:
            control, depth = queue.pop(0)
            if depth > search_depth:
                continue
            if control.ControlTypeName == control_type and (name is None or control.Name == name):
                return control
            for child in control.GetChildren():
                queue.append((child, depth + 1))
        return MissingControl()

    def ButtonControl(self, Name: str | None = None, searchDepth: int = 1, **kwargs):
        return self._find_first("ButtonControl", Name, searchDepth)

    def ListControl(self, Name: str | None = None, searchDepth: int = 1, **kwargs):
        return self._find_first("ListControl", Name, searchDepth)

    def ListItemControl(self, Name: str | None = None, searchDepth: int = 1, **kwargs):
        return self._find_first("ListItemControl", Name, searchDepth)

    def TextControl(self, Name: str | None = None, searchDepth: int = 1, **kwargs):
        return self._find_first("TextControl", Name, searchDepth)

    def EditControl(self, Name: str | None = None, searchDepth: int = 1, foundIndex: int | None = None, **kwargs):
        if foundIndex is not None:
            matches = []
            queue: list[tuple["FakeControl", int]] = [(child, 1) for child in self._children]
            while queue:
                control, depth = queue.pop(0)
                if depth > searchDepth:
                    continue
                if control.ControlTypeName == "EditControl" and (Name is None or control.Name == Name):
                    matches.append(control)
                for child in control.GetChildren():
                    queue.append((child, depth + 1))
            if 0 < foundIndex <= len(matches):
                return matches[foundIndex - 1]
            return MissingControl()
        return self._find_first("EditControl", Name, searchDepth)


class MissingControl(FakeControl):
    def __init__(self):
        super().__init__()

    def Exists(self, timeout: float = 0.0):
        return False


class FakeAuto:
    def __init__(self, root: FakeControl):
        self._root = root

    def GetRootControl(self):
        return self._root

    def MenuItemControl(self, Name: str | None = None, searchDepth: int = 1, **kwargs):
        return self._root._find_first("MenuItemControl", Name, searchDepth)

    def ButtonControl(self, Name: str | None = None, searchDepth: int = 1, **kwargs):
        return self._root._find_first("ButtonControl", Name, searchDepth)

    def ListItemControl(self, Name: str | None = None, searchDepth: int = 1, **kwargs):
        return self._root._find_first("ListItemControl", Name, searchDepth)

    def TextControl(self, Name: str | None = None, searchDepth: int = 1, **kwargs):
        return self._root._find_first("TextControl", Name, searchDepth)


class WechatAutomationSelectorsTest(unittest.TestCase):
    def test_find_plus_button_prefers_quick_action_button_next_to_search_box(self):
        search_box = FakeControl(
            name="搜索",
            control_type="EditControl",
            rect=(120, 160, 360, 192),
        )
        quick_action = FakeControl(
            name=QUICK_ACTION_NAME,
            control_type="ButtonControl",
            class_name="mmui::XButton",
            rect=(374, 160, 404, 192),
        )
        sidebar_more = FakeControl(
            name="更多",
            control_type="ButtonControl",
            class_name="mmui::XButton",
            rect=(60, 680, 96, 716),
        )
        window = FakeControl(
            name="微信",
            control_type="WindowControl",
            rect=(0, 120, 960, 760),
            children=[search_box, quick_action, sidebar_more],
        )

        result = find_plus_button(window)

        self.assertIs(result, quick_action)

    def test_find_add_friend_entry_prefers_quick_action_list_item_within_window(self):
        add_friend_item = FakeControl(
            name=ADD_FRIEND_NAME,
            control_type="ListItemControl",
            rect=(410, 212, 520, 242),
        )
        quick_action_list = FakeControl(
            name=QUICK_ACTION_NAME,
            control_type="ListControl",
            rect=(392, 198, 560, 360),
            children=[add_friend_item],
        )
        window = FakeControl(
            name="微信",
            control_type="WindowControl",
            rect=(0, 120, 960, 760),
            children=[quick_action_list],
        )
        root = FakeControl(control_type="RootControl", children=[window])
        auto = FakeAuto(root)

        window_rect = (0, 120, 960, 760)
        menu_region = build_menu_probe_region(window_rect, (374, 160, 404, 192))

        result = find_add_friend_entry(auto, window, window_rect, menu_region)

        self.assertIs(result, add_friend_item)

    def test_find_request_greeting_editor_prefers_multiline_editor_below_label(self):
        label = FakeControl(
            name=REQUEST_LABEL_NAME,
            control_type="TextControl",
            rect=(180, 220, 380, 250),
        )
        unrelated_edit = FakeControl(
            name="搜索",
            control_type="EditControl",
            rect=(180, 170, 420, 200),
        )
        greeting_edit = FakeControl(
            name="",
            control_type="EditControl",
            rect=(180, 262, 520, 362),
        )
        window = FakeControl(
            name="申请添加朋友",
            control_type="WindowControl",
            rect=(120, 120, 760, 560),
            children=[label, unrelated_edit, greeting_edit],
        )

        result = find_request_greeting_editor(window)

        self.assertIs(result, greeting_edit)

    def test_build_menu_probe_region_is_clamped_inside_window(self):
        window_rect = (100, 100, 900, 700)
        plus_rect = (860, 120, 888, 148)

        region = build_menu_probe_region(window_rect, plus_rect)

        self.assertGreaterEqual(region[0], window_rect[0])
        self.assertGreaterEqual(region[1], window_rect[1])
        self.assertLessEqual(region[2], window_rect[2])
        self.assertLessEqual(region[3], window_rect[3])


if __name__ == "__main__":
    unittest.main()

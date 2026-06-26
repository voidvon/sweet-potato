import unittest

from ai_worker.wechat_automation.constants import (
    ADD_FRIEND_NAME,
    ADD_TO_CONTACTS_NAME,
    PANEL_CHAT_NAME,
    PANEL_CONTACTS_NAME,
    QUICK_ACTION_NAME,
    REQUEST_LABEL_NAME,
    SEND_MESSAGE_NAME,
)
from ai_worker.wechat_automation.selectors import (
    build_menu_probe_region,
    click_add_to_contacts_strict,
    click_send_message,
    collect_chat_search_result_texts,
    find_add_friend_entry,
    find_add_friend_result_actions,
    find_chat_message_editor,
    find_chat_list_search_box,
    find_plus_button,
    find_request_greeting_editor,
    find_search_box,
    find_send_message_button_strict,
    find_sidebar_panel_button,
    identify_current_panel,
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
        selected: bool | None = None,
        toggle_state: int | None = None,
        legacy_state: int | None = None,
    ):
        self.Name = name
        self.ControlTypeName = control_type
        self.ClassName = class_name
        self.AutomationId = ""
        self._rect = FakeRect(*rect) if rect is not None else None
        self._children = children or []
        self._selected = selected
        self._toggle_state = toggle_state
        self._legacy_state = legacy_state
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

    @property
    def IsSelected(self):
        return self._selected

    def GetTogglePattern(self):
        if self._toggle_state is None:
            return None

        class TogglePattern:
            def __init__(self, toggle_state: int):
                self.ToggleState = toggle_state

        return TogglePattern(self._toggle_state)

    def GetLegacyIAccessiblePattern(self):
        if self._legacy_state is None:
            return None

        class LegacyPattern:
            def __init__(self, state: int):
                self.State = state

        return LegacyPattern(self._legacy_state)

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
    def test_find_sidebar_panel_button_prefers_named_contacts_button(self):
        chat_button = FakeControl(
            name="微信",
            control_type="ButtonControl",
            rect=(20, 160, 68, 208),
        )
        contacts_button = FakeControl(
            name="通讯录",
            control_type="ButtonControl",
            rect=(20, 220, 68, 268),
        )
        window = FakeControl(
            name="微信",
            control_type="WindowControl",
            rect=(0, 120, 960, 760),
            children=[chat_button, contacts_button],
        )

        control, info = find_sidebar_panel_button(window, PANEL_CONTACTS_NAME)

        self.assertIs(control, contacts_button)
        self.assertEqual(info["method"], "sidebar_name")

    def test_find_sidebar_panel_button_falls_back_to_sidebar_order(self):
        first_button = FakeControl(
            name="",
            control_type="ButtonControl",
            rect=(20, 160, 68, 208),
        )
        second_button = FakeControl(
            name="",
            control_type="ButtonControl",
            rect=(20, 220, 68, 268),
        )
        window = FakeControl(
            name="微信",
            control_type="WindowControl",
            rect=(0, 120, 960, 760),
            children=[first_button, second_button],
        )

        control, info = find_sidebar_panel_button(window, PANEL_CONTACTS_NAME)

        self.assertIs(control, second_button)
        self.assertEqual(info["method"], "sidebar_order")
        self.assertEqual(info["targetIndex"], 1)

    def test_identify_current_panel_uses_quick_action_rule_for_chat_panel(self):
        quick_action = FakeControl(
            name=QUICK_ACTION_NAME,
            control_type="ButtonControl",
            rect=(374, 160, 404, 192),
        )
        window = FakeControl(
            name="微信",
            control_type="WindowControl",
            rect=(0, 120, 960, 760),
            children=[quick_action],
        )

        result = identify_current_panel(window)

        self.assertEqual(result["panel"], PANEL_CHAT_NAME)
        self.assertEqual(result["matchedRule"], "quick_action_button")

    def test_identify_current_panel_uses_contacts_manage_rule_for_contacts_panel(self):
        manage_button = FakeControl(
            name="通讯录管理",
            control_type="ButtonControl",
            rect=(720, 160, 840, 192),
        )
        window = FakeControl(
            name="微信",
            control_type="WindowControl",
            rect=(0, 120, 960, 760),
            children=[manage_button],
        )

        result = identify_current_panel(window)

        self.assertEqual(result["panel"], PANEL_CONTACTS_NAME)
        self.assertEqual(result["matchedRule"], "contacts_manage_button")

    def test_identify_current_panel_finds_contacts_manage_outside_main_content_region(self):
        manage_button = FakeControl(
            name="通讯录管理",
            control_type="ButtonControl",
            rect=(60, 160, 150, 192),
        )
        window = FakeControl(
            name="微信",
            control_type="WindowControl",
            rect=(0, 120, 960, 760),
            children=[manage_button],
        )

        result = identify_current_panel(window)

        self.assertEqual(result["panel"], PANEL_CONTACTS_NAME)
        self.assertEqual(result["matchedRule"], "contacts_manage_button")

    def test_identify_current_panel_uses_contacts_feature_count(self):
        controls = [
            FakeControl(name="新的朋友", control_type="TextControl", rect=(180, 160, 280, 192)),
            FakeControl(name="公众号", control_type="TextControl", rect=(180, 210, 280, 242)),
            FakeControl(name="企业微信联系人", control_type="TextControl", rect=(180, 260, 340, 292)),
        ]
        window = FakeControl(
            name="微信",
            control_type="WindowControl",
            rect=(0, 120, 960, 760),
            children=controls,
        )

        result = identify_current_panel(window)

        self.assertEqual(result["panel"], PANEL_CONTACTS_NAME)
        self.assertEqual(result["matchedRule"], "contacts_feature_count")
        self.assertEqual(result["contactFeatureMatchCount"], 3)

    def test_identify_current_panel_requires_three_contacts_features(self):
        controls = [
            FakeControl(name="新的朋友", control_type="TextControl", rect=(180, 160, 280, 192)),
            FakeControl(name="公众号", control_type="TextControl", rect=(180, 210, 280, 242)),
        ]
        window = FakeControl(
            name="微信",
            control_type="WindowControl",
            rect=(0, 120, 960, 760),
            children=controls,
        )

        result = identify_current_panel(window)

        self.assertIsNone(result["panel"])

    def test_identify_current_panel_uses_all_favorites_rule_for_favorites_panel(self):
        all_favorites = FakeControl(
            name="全部收藏",
            control_type="TextControl",
            rect=(180, 160, 280, 192),
        )
        window = FakeControl(
            name="微信",
            control_type="WindowControl",
            rect=(0, 120, 960, 760),
            children=[all_favorites],
        )

        result = identify_current_panel(window)

        self.assertEqual(result["panel"], "收藏")
        self.assertEqual(result["matchedRule"], "all_favorites_entry")

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

    def test_find_search_box_prefers_left_top_chat_search(self):
        chat_search_box = FakeControl(
            name="搜索",
            control_type="EditControl",
            rect=(160, 170, 420, 202),
        )
        message_editor = FakeControl(
            name="virjay",
            control_type="EditControl",
            rect=(520, 600, 980, 700),
        )
        window = FakeControl(
            name="微信",
            control_type="WindowControl",
            rect=(0, 120, 1200, 780),
            children=[chat_search_box, message_editor],
        )

        result = find_search_box(window, (0, 120, 1200, 780))

        self.assertIs(result, chat_search_box)

    def test_find_chat_list_search_box_uses_quick_action_left_neighbor(self):
        chat_search_box = FakeControl(
            name="搜索",
            control_type="EditControl",
            rect=(160, 170, 360, 202),
        )
        quick_action = FakeControl(
            name=QUICK_ACTION_NAME,
            control_type="ButtonControl",
            class_name="mmui::XButton",
            rect=(374, 170, 404, 202),
        )
        unrelated_search = FakeControl(
            name="搜索",
            control_type="EditControl",
            rect=(520, 600, 980, 700),
        )
        window = FakeControl(
            name="微信",
            control_type="WindowControl",
            rect=(0, 120, 1200, 780),
            children=[unrelated_search, chat_search_box, quick_action],
        )

        result = find_chat_list_search_box(window, (0, 120, 1200, 780))

        self.assertIs(result, chat_search_box)

    def test_collect_chat_search_result_texts_returns_result_names(self):
        exact_wechat_id = FakeControl(
            name="wxid_abc123",
            control_type="TextControl",
            rect=(170, 230, 320, 258),
        )
        partial_match = FakeControl(
            name="wxid_abc1234",
            control_type="TextControl",
            rect=(170, 270, 340, 298),
        )
        outside_text = FakeControl(
            name="wxid_outside",
            control_type="TextControl",
            rect=(800, 650, 940, 680),
        )
        window = FakeControl(
            name="微信",
            control_type="WindowControl",
            rect=(0, 120, 1200, 780),
            children=[exact_wechat_id, partial_match, outside_text],
        )

        texts = collect_chat_search_result_texts(window, (0, 120, 1200, 780), (160, 170, 360, 202))

        self.assertIn("wxid_abc123", texts)
        self.assertIn("wxid_abc1234", texts)
        self.assertNotIn("wxid_outside", texts)

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

    def test_click_send_message_prefers_exact_button(self):
        send_button = FakeControl(
            name=SEND_MESSAGE_NAME,
            control_type="ButtonControl",
            rect=(520, 420, 640, 458),
        )
        hint_text = FakeControl(
            name="发消息给对方",
            control_type="TextControl",
            rect=(300, 240, 420, 270),
        )
        profile_window = FakeControl(
            name="添加朋友",
            control_type="WindowControl",
            rect=(120, 120, 760, 620),
            children=[hint_text, send_button],
        )
        root = FakeControl(control_type="RootControl", children=[profile_window])
        auto = FakeAuto(root)

        result, candidates = click_send_message(auto, profile_window)

        self.assertIs(result, send_button)
        self.assertTrue(send_button.clicked)
        self.assertGreaterEqual(len(candidates), 1)

    def test_find_send_message_button_strict_does_not_click(self):
        send_button = FakeControl(
            name=SEND_MESSAGE_NAME,
            control_type="ButtonControl",
            rect=(520, 420, 640, 458),
        )
        profile_window = FakeControl(
            name="添加朋友",
            control_type="WindowControl",
            rect=(120, 120, 760, 620),
            children=[send_button],
        )

        result, candidates = find_send_message_button_strict(profile_window)

        self.assertIs(result, send_button)
        self.assertFalse(send_button.clicked)
        self.assertEqual(candidates, [send_button])

    def test_find_add_friend_result_actions_collects_actions_in_one_scan(self):
        add_to_contacts_button = FakeControl(
            name=ADD_TO_CONTACTS_NAME,
            control_type="ButtonControl",
            rect=(420, 420, 520, 458),
        )
        send_button = FakeControl(
            name=SEND_MESSAGE_NAME,
            control_type="ButtonControl",
            rect=(540, 420, 640, 458),
        )
        profile_window = FakeControl(
            name="添加朋友",
            control_type="WindowControl",
            rect=(120, 120, 760, 620),
            children=[add_to_contacts_button, send_button],
        )

        actions = find_add_friend_result_actions(profile_window)

        self.assertIs(actions["add_to_contacts"], add_to_contacts_button)
        self.assertIs(actions["send_message"], send_button)
        self.assertFalse(add_to_contacts_button.clicked)
        self.assertFalse(send_button.clicked)

    def test_click_add_to_contacts_does_not_fall_back_to_add_friend_label(self):
        add_friend_label = FakeControl(
            name=ADD_FRIEND_NAME,
            control_type="TextControl",
            rect=(300, 240, 420, 270),
        )
        profile_window = FakeControl(
            name="添加朋友",
            control_type="WindowControl",
            rect=(120, 120, 760, 620),
            children=[add_friend_label],
        )
        root = FakeControl(control_type="RootControl", children=[profile_window])
        auto = FakeAuto(root)

        result, _candidates = click_add_to_contacts_strict(auto, profile_window)

        self.assertIsNone(result)
        self.assertFalse(add_friend_label.clicked)

    def test_click_add_to_contacts_strict_ignores_contacts_panel_button(self):
        contacts_panel_button = FakeControl(
            name="切换到通讯录",
            control_type="ButtonControl",
            class_name="ant-btn",
            rect=(520, 420, 640, 458),
        )
        profile_window = FakeControl(
            name="添加朋友",
            control_type="WindowControl",
            rect=(120, 120, 760, 620),
            children=[],
        )
        root = FakeControl(control_type="RootControl", children=[profile_window, contacts_panel_button])
        auto = FakeAuto(root)

        result, _candidates = click_add_to_contacts_strict(auto, profile_window)

        self.assertIsNone(result)
        self.assertFalse(contacts_panel_button.clicked)

    def test_find_chat_message_editor_prefers_bottom_multiline_editor(self):
        search_box = FakeControl(
            name="搜索",
            control_type="EditControl",
            rect=(160, 170, 420, 202),
        )
        message_editor = FakeControl(
            name="",
            control_type="EditControl",
            rect=(280, 560, 900, 660),
        )
        window = FakeControl(
            name="微信",
            control_type="WindowControl",
            rect=(0, 120, 960, 760),
            children=[search_box, message_editor],
        )

        result = find_chat_message_editor(window)

        self.assertIs(result, message_editor)

    def test_find_chat_message_editor_ignores_top_search_box(self):
        search_box = FakeControl(
            name="搜索",
            control_type="EditControl",
            rect=(260, 170, 430, 202),
        )
        window = FakeControl(
            name="微信",
            control_type="WindowControl",
            rect=(0, 120, 960, 760),
            children=[search_box],
        )

        result = find_chat_message_editor(window)

        self.assertIsNone(result)

    def test_find_chat_message_editor_prefers_edit_over_large_document(self):
        chat_document = FakeControl(
            name="萌猫",
            control_type="DocumentControl",
            rect=(280, 120, 960, 700),
        )
        message_editor = FakeControl(
            name="virjay",
            control_type="EditControl",
            rect=(360, 560, 900, 650),
        )
        window = FakeControl(
            name="微信",
            control_type="WindowControl",
            rect=(0, 120, 960, 760),
            children=[chat_document, message_editor],
        )

        result = find_chat_message_editor(window)

        self.assertIs(result, message_editor)

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

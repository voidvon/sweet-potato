from __future__ import annotations

import json
import re
from typing import Any

from .constants import (
    ADD_FRIEND_NAME,
    ADD_TO_CONTACTS_NAME,
    PANEL_CHAT_NAME,
    PANEL_CONTACTS_NAME,
    PANEL_FAVORITES_NAME,
    QUICK_ACTION_NAME,
    REQUEST_FRIEND_NAME,
    REQUEST_LABEL_NAME,
    SEND_MESSAGE_NAME,
)
from .models import ProbeNode, Rect
from .uia import (
    click_first_existing,
    control_class,
    control_name,
    control_type,
    describe_control,
    get_rect_tuple,
    is_same_row,
    iter_controls,
    iter_descendants,
    rect_center,
    rect_center_within,
    rect_intersects,
    serialize_probe_node,
)


def build_menu_probe_region(window_rect: Rect, plus_rect: Rect | None) -> Rect:
    win_left, win_top, win_right, win_bottom = window_rect
    width = win_right - win_left
    height = win_bottom - win_top

    region_left = win_left + int(width * 0.52)
    region_top = win_top
    region_right = win_right + int(width * 0.2)
    region_bottom = win_top + int(height * 0.6)

    if plus_rect:
        region_left = min(region_left, plus_rect[0] - 40)
        region_top = min(region_top, plus_rect[1] - 20)
        region_right = max(region_right, plus_rect[2] + 240)
        region_bottom = max(region_bottom, plus_rect[3] + 420)

    return (
        max(win_left, region_left),
        max(win_top, region_top),
        min(win_right, region_right),
        min(win_bottom, region_bottom),
    )


def is_top_right(rect: Rect, window_rect: Rect) -> bool:
    left, top, _right, _bottom = rect
    win_left, win_top, win_right, win_bottom = window_rect
    width = max(win_right - win_left, 1)
    height = max(win_bottom - win_top, 1)
    return left >= win_left + int(width * 0.62) and top <= win_top + int(height * 0.22)


def is_top_toolbar_button(rect: Rect, window_rect: Rect) -> bool:
    left, top, right, bottom = rect
    win_left, win_top, _win_right, win_bottom = window_rect
    win_height = max(win_bottom - win_top, 1)
    width = right - left
    height = bottom - top

    if top > win_top + int(win_height * 0.22):
        return False
    if width < 18 or width > 72 or height < 18 or height > 64:
        return False
    if left < win_left:
        return False
    return True


def is_sidebar_control(rect: Rect, window_rect: Rect) -> bool:
    win_left, win_top, win_right, win_bottom = window_rect
    width = max(win_right - win_left, 1)
    center_x, center_y = rect_center(rect)
    return (
        win_left <= center_x <= win_left + max(120, int(width * 0.16))
        and win_top <= center_y <= win_bottom
    )


def is_sidebar_nav_candidate(control: Any, rect: Rect, window_rect: Rect) -> bool:
    if not is_sidebar_control(rect, window_rect):
        return False

    type_name = control_type(control)
    if type_name not in {"ButtonControl", "ListItemControl", "PaneControl", "GroupControl", "CustomControl", "TextControl"}:
        return False

    width = rect[2] - rect[0]
    height = rect[3] - rect[1]
    if width > 120 or height > 96:
        return False

    win_top = window_rect[1]
    # Keep the first navigation icon; WeChat's avatar/title area varies by version and DPI.
    return rect[1] >= win_top + 24


def is_main_content_control(rect: Rect, window_rect: Rect) -> bool:
    win_left, win_top, win_right, win_bottom = window_rect
    width = max(win_right - win_left, 1)
    center_x, center_y = rect_center(rect)
    return (
        center_x >= win_left + max(120, int(width * 0.16))
        and win_top <= center_y <= win_bottom
    )


def _read_bool_like(value: Any) -> bool | None:
    if callable(value):
        try:
            value = value()
        except Exception:
            value = None
    if isinstance(value, bool):
        return value
    if isinstance(value, int):
        return bool(value)
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"true", "1", "on", "selected", "checked", "pressed"}:
            return True
        if normalized in {"false", "0", "off", "unselected", "unchecked", "normal"}:
            return False
    return None


def _read_toggle_state(value: Any) -> bool | None:
    if callable(value):
        try:
            value = value()
        except Exception:
            value = None
    if isinstance(value, bool):
        return value
    if isinstance(value, int):
        # UIA ToggleState: 0=Off, 1=On, 2=Indeterminate.
        if value == 1:
            return True
        if value == 0:
            return False
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"on", "toggleon", "1", "true"}:
            return True
        if normalized in {"off", "toggleoff", "0", "false"}:
            return False
    return None


def _read_legacy_state(value: Any) -> bool | None:
    if callable(value):
        try:
            value = value()
        except Exception:
            value = None
    if isinstance(value, int):
        selected = bool(value & 0x2)
        checked = bool(value & 0x10)
        pressed = bool(value & 0x8)
        if selected or checked or pressed:
            return True
    if isinstance(value, str):
        normalized = value.lower()
        if any(token in normalized for token in ("selected", "checked", "pressed", "选中", "已选")):
            return True
    return None


def _read_direct_selected_state_details(control: Any) -> dict[str, Any]:
    for attr_name in ("IsSelected", "Selected"):
        selected = _read_bool_like(getattr(control, attr_name, None))
        if selected is not None:
            return {"selected": selected, "source": attr_name}

    selection_pattern_getter = getattr(control, "GetSelectionItemPattern", None)
    if callable(selection_pattern_getter):
        try:
            selection_pattern = selection_pattern_getter()
        except Exception:
            selection_pattern = None
        if selection_pattern is not None:
            selected = _read_bool_like(getattr(selection_pattern, "IsSelected", None))
            if selected is not None:
                return {"selected": selected, "source": "SelectionItemPattern.IsSelected"}

    toggle_pattern_getter = getattr(control, "GetTogglePattern", None)
    if callable(toggle_pattern_getter):
        try:
            toggle_pattern = toggle_pattern_getter()
        except Exception:
            toggle_pattern = None
        if toggle_pattern is not None:
            selected = _read_toggle_state(getattr(toggle_pattern, "ToggleState", None))
            if selected is not None:
                return {"selected": selected, "source": "TogglePattern.ToggleState"}

    legacy_pattern_getter = getattr(control, "GetLegacyIAccessiblePattern", None)
    if callable(legacy_pattern_getter):
        try:
            legacy_pattern = legacy_pattern_getter()
        except Exception:
            legacy_pattern = None
        if legacy_pattern is not None:
            for attr_name in ("State", "CurrentState"):
                selected = _read_legacy_state(getattr(legacy_pattern, attr_name, None))
                if selected is not None:
                    return {"selected": selected, "source": f"LegacyIAccessiblePattern.{attr_name}"}

    return {"selected": None, "source": None}


def read_selected_state_details(control: Any) -> dict[str, Any]:
    details: dict[str, Any] = {"selected": None, "source": None}

    for attr_name in ("IsSelected", "Selected"):
        selected = _read_bool_like(getattr(control, attr_name, None))
        if selected is not None:
            return {"selected": selected, "source": attr_name}

    selection_pattern_getter = getattr(control, "GetSelectionItemPattern", None)
    if callable(selection_pattern_getter):
        try:
            selection_pattern = selection_pattern_getter()
        except Exception:
            selection_pattern = None
        if selection_pattern is not None:
            selected = _read_bool_like(getattr(selection_pattern, "IsSelected", None))
            if selected is not None:
                return {"selected": selected, "source": "SelectionItemPattern.IsSelected"}

    toggle_pattern_getter = getattr(control, "GetTogglePattern", None)
    if callable(toggle_pattern_getter):
        try:
            toggle_pattern = toggle_pattern_getter()
        except Exception:
            toggle_pattern = None
        if toggle_pattern is not None:
            selected = _read_toggle_state(getattr(toggle_pattern, "ToggleState", None))
            if selected is not None:
                return {"selected": selected, "source": "TogglePattern.ToggleState"}

    legacy_pattern_getter = getattr(control, "GetLegacyIAccessiblePattern", None)
    if callable(legacy_pattern_getter):
        try:
            legacy_pattern = legacy_pattern_getter()
        except Exception:
            legacy_pattern = None
        if legacy_pattern is not None:
            for attr_name in ("State", "CurrentState"):
                selected = _read_legacy_state(getattr(legacy_pattern, attr_name, None))
                if selected is not None:
                    return {"selected": selected, "source": f"LegacyIAccessiblePattern.{attr_name}"}

    for child, _depth in iter_controls(control, max_depth=1):
        child_details = _read_direct_selected_state_details(child)
        if child_details.get("selected") is True:
            child_details["source"] = f"child.{child_details.get('source')}"
            child_details["control"] = describe_control(child)
            return child_details

    parent_getter = getattr(control, "GetParentControl", None)
    if callable(parent_getter):
        try:
            parent = parent_getter()
        except Exception:
            parent = None
        if parent is not None:
            parent_details = _read_direct_selected_state_details(parent)
            if parent_details.get("selected") is True:
                parent_details["source"] = f"parent.{parent_details.get('source')}"
                parent_details["control"] = describe_control(parent)
                return parent_details

    return details


def read_selected_state(control: Any) -> bool | None:
    details = read_selected_state_details(control)
    selected = details.get("selected")
    return selected if isinstance(selected, bool) else None


def match_panel_from_text(text: str, panel_aliases: dict[str, tuple[str, ...]]) -> str | None:
    if not text:
        return None
    return next(
        (
            panel
            for panel, aliases in panel_aliases.items()
            if any(alias == text or alias in text for alias in aliases)
        ),
        None,
    )


def infer_panel_from_sidebar_order(index: int) -> str | None:
    ordered_panels = (PANEL_CHAT_NAME, PANEL_CONTACTS_NAME, PANEL_FAVORITES_NAME)
    if 0 <= index < len(ordered_panels):
        return ordered_panels[index]
    return None


def find_sidebar_panel_button(window: Any, panel: str) -> tuple[Any | None, dict[str, Any]]:
    window_rect = get_rect_tuple(window)
    if not window_rect:
        raise RuntimeError("无法读取微信窗口坐标，无法定位侧边栏面板按钮")

    panel_aliases = {
        PANEL_CHAT_NAME: (PANEL_CHAT_NAME, "聊天", "会话", "消息"),
        PANEL_CONTACTS_NAME: (PANEL_CONTACTS_NAME, "通讯录", "联系人", "朋友"),
    }
    aliases = panel_aliases.get(panel)
    if not aliases:
        raise RuntimeError(f"不支持切换到面板: {panel}")

    candidates: list[tuple[int, int, Any]] = []
    nav_controls: list[tuple[int, Any]] = []
    for control, depth in iter_controls(window, max_depth=10):
        rect = get_rect_tuple(control)
        if rect is None or not is_sidebar_nav_candidate(control, rect, window_rect):
            continue

        center_y = rect_center(rect)[1]
        if any(abs(center_y - existing_y) <= 12 for existing_y, _control in nav_controls):
            continue
        nav_controls.append((center_y, control))

        name = control_name(control)
        if any(alias == name or alias in name for alias in aliases):
            score = 30
            if control_type(control) == "ButtonControl":
                score += 8
            elif control_type(control) in {"PaneControl", "CustomControl", "GroupControl"}:
                score += 4
            candidates.append((score, depth, control))

    if candidates:
        candidates.sort(key=lambda item: (-item[0], item[1]))
        best = candidates[0][2]
        return best, {
            "method": "sidebar_name",
            "targetPanel": panel,
            "control": serialize_probe_node(best, candidates[0][1], "window"),
        }

    nav_controls.sort(key=lambda item: item[0])
    target_index = 0 if panel == PANEL_CHAT_NAME else 1 if panel == PANEL_CONTACTS_NAME else -1
    if 0 <= target_index < len(nav_controls):
        control = nav_controls[target_index][1]
        return control, {
            "method": "sidebar_order",
            "targetPanel": panel,
            "targetIndex": target_index,
            "control": serialize_probe_node(control, target_index, "window"),
            "navControlCount": len(nav_controls),
        }

    return None, {
        "method": "not_found",
        "targetPanel": panel,
        "navControlCount": len(nav_controls),
    }



def identify_current_panel(window: Any) -> dict[str, Any]:
    window_rect = get_rect_tuple(window)
    if not window_rect:
        raise RuntimeError("无法读取微信窗口坐标，无法识别当前面板")

    rule_matches: list[dict[str, Any]] = []
    window_control_names: list[str] = []
    rules = (
        (PANEL_CONTACTS_NAME, "通讯录管理", "contacts_manage_button"),
        (PANEL_FAVORITES_NAME, "全部收藏", "all_favorites_entry"),
        (PANEL_CHAT_NAME, QUICK_ACTION_NAME, "quick_action_button"),
    )
    contact_feature_rules = (
        ("new_friends", "新的朋友", "contains"),
        ("official_accounts", "公众号", "startswith"),
        ("service_accounts", "服务号", "startswith"),
        ("enterprise_wechat_contacts", "企业微信联系人", "startswith"),
        ("contacts", "联系人", "startswith"),
    )
    contact_feature_matches: dict[str, dict[str, Any]] = {}

    for control, depth in iter_controls(window, max_depth=12):
        name = control_name(control)
        if not name:
            continue
        rect = get_rect_tuple(control)
        if rect is not None and not rect_center_within(rect, window_rect, tolerance=24):
            continue
        window_control_names.append(name)
        for panel, keyword, rule in rules:
            if keyword == name or keyword in name:
                payload = serialize_probe_node(control, depth, "window")
                payload["panel"] = panel
                payload["keyword"] = keyword
                payload["rule"] = rule
                rule_matches.append(payload)
        for feature, keyword, match_type in contact_feature_rules:
            matched = keyword in name if match_type == "contains" else name.startswith(keyword)
            if not matched or feature in contact_feature_matches:
                continue
            payload = serialize_probe_node(control, depth, "window")
            payload["feature"] = feature
            payload["keyword"] = keyword
            payload["matchType"] = match_type
            contact_feature_matches[feature] = payload

    if len(contact_feature_matches) >= 3:
        matches = list(contact_feature_matches.values())
        return {
            "panel": PANEL_CONTACTS_NAME,
            "confidence": 0.92,
            "method": "contacts_feature_count",
            "matchedRule": "contacts_feature_count",
            "matchedKeyword": " / ".join(str(item.get("keyword")) for item in matches),
            "contactFeatureMatchCount": len(matches),
            "contactFeatureMatches": matches,
            "signals": [f"命中 {len(matches)} 个通讯录特征，判定为“{PANEL_CONTACTS_NAME}”面板"],
            "mainControlNames": window_control_names[:80],
            "windowControlNames": window_control_names[:80],
        }

    if rule_matches:
        rule_priority = {
            "contacts_manage_button": 0,
            "all_favorites_entry": 1,
            "quick_action_button": 2,
        }
        rule_matches.sort(key=lambda item: (rule_priority.get(str(item.get("rule")), 99), item.get("depth", 99)))
        best_match = rule_matches[0]
        panel = best_match.get("panel")
        keyword = best_match.get("keyword")
        return {
            "panel": panel,
            "confidence": 0.96,
            "method": "main_content_rule",
            "matchedRule": best_match.get("rule"),
            "matchedKeyword": keyword,
            "matchedControl": best_match,
            "ruleMatches": rule_matches[:20],
            "signals": [f"微信窗口内存在“{keyword}”，判定为“{panel}”面板"],
            "mainControlNames": window_control_names[:80],
            "windowControlNames": window_control_names[:80],
        }

    return {
        "panel": None,
        "confidence": 0.0,
        "method": "main_content_rule",
        "matchedRule": None,
        "signals": ["未命中面板识别规则：快捷操作 / 通讯录管理 / 全部收藏"],
        "mainControlNames": window_control_names[:80],
        "windowControlNames": window_control_names[:80],
    }


def is_control_in_wechat_region(control: Any, window_rect: Rect, menu_region: Rect) -> bool:
    rect = get_rect_tuple(control)
    if not rect:
        return False
    return rect_center_within(rect, window_rect, tolerance=16) and rect_intersects(rect, menu_region)


def should_include_probe_control(control: Any, window_rect: Rect, menu_region: Rect) -> bool:
    name = control_name(control)
    type_name = control_type(control)
    class_name = control_class(control)
    rect = get_rect_tuple(control)

    if ADD_FRIEND_NAME in name or "朋友" in name:
        return rect is not None and rect_center_within(rect, window_rect, tolerance=16)
    if QUICK_ACTION_NAME in name:
        return rect is not None and rect_center_within(rect, window_rect, tolerance=16)
    if type_name in {"MenuControl", "MenuItemControl"} and rect is not None:
        return is_control_in_wechat_region(control, window_rect, menu_region)
    if rect and not rect_center_within(rect, window_rect, tolerance=16):
        return False
    if rect and rect_intersects(rect, menu_region):
        if type_name in {"ButtonControl", "TextControl", "ListItemControl", "PaneControl", "MenuControl", "MenuItemControl"}:
            return True
        if name:
            return True
        if "menu" in class_name.lower():
            return True
    if rect and is_top_right(rect, window_rect) and name:
        return True
    return False


def score_search_candidate(control: Any, window_rect: Rect) -> int:
    name = control_name(control)
    type_name = control_type(control)
    rect = get_rect_tuple(control)
    if rect is None:
        return 0

    left, top, right, bottom = rect
    width = right - left
    height = bottom - top
    win_left, win_top, _win_right, win_bottom = window_rect
    win_width = max(window_rect[2] - window_rect[0], 1)
    win_height = max(win_bottom - win_top, 1)
    score = 0

    if top > win_top + int(win_height * 0.28):
        return 0
    if type_name in {"EditControl", "PaneControl", "GroupControl"}:
        score += 4
    if "搜索" in name:
        score += 18
    if "search" in name.lower():
        score += 12
    if win_left + int(win_width * 0.10) <= left <= win_left + int(win_width * 0.72):
        score += 4
    if 120 <= width <= 360:
        score += 6
    if 24 <= height <= 56:
        score += 3
    return score


def find_search_box(window: Any, window_rect: Rect) -> Any | None:
    candidates: list[tuple[int, Any]] = []
    for control, _depth in iter_controls(window, max_depth=6):
        score = score_search_candidate(control, window_rect)
        if score > 0:
            candidates.append((score, control))

    if not candidates:
        return None
    candidates.sort(key=lambda item: item[0], reverse=True)
    best_score, best_control = candidates[0]
    return best_control if best_score >= 10 else None


def find_chat_list_search_box(window: Any, window_rect: Rect) -> Any | None:
    quick_action = None
    try:
        quick_action = find_plus_button(window)
    except Exception:
        quick_action = None

    quick_action_rect = get_rect_tuple(quick_action) if quick_action is not None else None
    candidates: list[tuple[int, Any]] = []
    max_depth = 12 if quick_action_rect is not None else 8
    for control, _depth in iter_controls(window, max_depth=max_depth):
        type_name = control_type(control)
        if type_name not in {"EditControl", "PaneControl", "GroupControl"}:
            continue
        rect = get_rect_tuple(control)
        if rect is None or not rect_center_within(rect, window_rect, tolerance=24):
            continue

        name = control_name(control)
        left, top, right, bottom = rect
        width = right - left
        height = bottom - top
        score = score_search_candidate(control, window_rect)

        if quick_action_rect is not None:
            if rect[2] > quick_action_rect[0] + 8:
                continue
            if not is_same_row(rect, quick_action_rect, tolerance=28):
                continue
            score += 30
            gap = quick_action_rect[0] - rect[2]
            if 0 <= gap <= 140:
                score += 12

        if "搜索" in name:
            score += 12
        if 18 <= height <= 64:
            score += 4
        if 80 <= width <= 420:
            score += 4
        if score > 0:
            candidates.append((score, control))

    if candidates:
        candidates.sort(key=lambda item: item[0], reverse=True)
        best_score, best_control = candidates[0]
        if best_score >= 10:
            return best_control

    return find_search_box(window, window_rect)


def collect_chat_search_result_texts(window: Any, window_rect: Rect, search_box_rect: Rect | None) -> list[str]:
    texts: list[str] = []
    seen: set[str] = set()
    if search_box_rect is None:
        return texts

    search_left, _search_top, search_right, search_bottom = search_box_rect
    result_region = (
        max(window_rect[0], search_left - 80),
        search_bottom - 8,
        min(window_rect[2], search_right + 420),
        min(window_rect[3], search_bottom + 420),
    )

    for control, _depth in iter_controls(window, max_depth=14):
        if control_type(control) not in {"TextControl", "ListItemControl", "ButtonControl", "PaneControl", "GroupControl"}:
            continue
        rect = get_rect_tuple(control)
        if rect is None or not rect_center_within(rect, result_region, tolerance=24):
            continue
        name = control_name(control).strip()
        if not name or name in seen:
            continue
        seen.add(name)
        texts.append(name)

    return texts


UNREAD_CHAT_TITLE_PATTERN = re.compile(r"^(?P<nickname>\S+)\s+\[(?P<unreadCount>\d+)条\]$")


def parse_unread_chat_title(text: str) -> dict[str, Any] | None:
    normalized = text.strip()
    if not normalized:
        return None

    match = UNREAD_CHAT_TITLE_PATTERN.fullmatch(normalized)
    if match is None:
        return None

    return {
        "text": normalized,
        "nickname": match.group("nickname"),
        "unreadCount": int(match.group("unreadCount")),
    }


def collect_control_texts(control: Any, max_depth: int = 2) -> list[str]:
    texts: list[str] = []
    seen: set[str] = set()

    for candidate in [control, *(child for child, _depth in iter_controls(control, max_depth=max_depth))]:
        name = control_name(candidate).strip()
        if not name or name in seen:
            continue
        seen.add(name)
        texts.append(name)

    return texts


def build_chat_conversation_list_region(window_rect: Rect, search_box_rect: Rect | None) -> Rect:
    win_left, win_top, win_right, win_bottom = window_rect
    width = max(win_right - win_left, 1)

    if search_box_rect is not None:
        region_left = max(win_left, search_box_rect[0] - 28)
        region_top = min(win_bottom, search_box_rect[3] + 20)
        region_right = min(win_right, search_box_rect[2] + 80)
    else:
        region_left = win_left + max(56, int(width * 0.05))
        region_top = win_top + 88
        region_right = min(win_right, win_left + max(280, int(width * 0.34)))

    return (
        region_left,
        region_top,
        region_right,
        max(region_top + 120, win_bottom - 12),
    )


def score_chat_conversation_item_candidate(control: Any, conversation_region: Rect) -> int:
    rect = get_rect_tuple(control)
    if rect is None or not rect_center_within(rect, conversation_region, tolerance=24):
        return 0

    type_name = control_type(control)
    if type_name not in {"ListItemControl", "ButtonControl", "PaneControl", "GroupControl", "CustomControl", "TextControl"}:
        return 0

    left, top, right, bottom = rect
    width = right - left
    height = bottom - top
    if height < 24 or height > 120:
        return 0
    if width < 80:
        return 0

    name = control_name(control)
    if name == QUICK_ACTION_NAME or "搜索" in name:
        return 0

    score = 0
    if type_name == "ListItemControl":
        score += 30
    elif type_name == "ButtonControl":
        score += 26
    elif type_name == "PaneControl":
        score += 20
    elif type_name == "GroupControl":
        score += 14
    elif type_name == "CustomControl":
        score += 10
    else:
        score += 5

    region_width = max(conversation_region[2] - conversation_region[0], 1)
    if width >= max(140, int(region_width * 0.55)):
        score += 12
    if 36 <= height <= 84:
        score += 10
    elif 28 <= height <= 100:
        score += 4
    if left <= conversation_region[0] + 48:
        score += 6
    if top <= conversation_region[1] + 96:
        score += 4

    if any(parse_unread_chat_title(text) for text in collect_control_texts(control, max_depth=1)):
        score += 40
    elif name:
        score += 3

    return score


def find_chat_conversation_list_container(window: Any, window_rect: Rect, search_box_rect: Rect | None) -> Any | None:
    conversation_region = build_chat_conversation_list_region(window_rect, search_box_rect)
    candidates: list[tuple[int, Any]] = []

    for control, _depth in iter_controls(window, max_depth=10):
        type_name = control_type(control)
        if type_name not in {"ListControl", "PaneControl", "GroupControl", "CustomControl"}:
            continue

        rect = get_rect_tuple(control)
        if rect is None or not rect_center_within(rect, conversation_region, tolerance=32):
            continue
        if search_box_rect is not None and rect[1] < search_box_rect[3] + 8:
            continue

        width = rect[2] - rect[0]
        height = rect[3] - rect[1]
        if width < 180 or height < 180:
            continue

        score = 0
        if type_name == "ListControl":
            score += 28
        elif type_name == "PaneControl":
            score += 16
        elif type_name == "GroupControl":
            score += 12
        else:
            score += 8

        if rect[0] <= conversation_region[0] + 24:
            score += 6
        if rect[1] <= conversation_region[1] + 32:
            score += 6
        if width >= conversation_region[2] - conversation_region[0] - 24:
            score += 8
        if height >= max(220, int((conversation_region[3] - conversation_region[1]) * 0.45)):
            score += 8
        if control_name(control):
            score -= 4

        candidates.append((score, control))

    if not candidates:
        return None

    candidates.sort(key=lambda item: item[0], reverse=True)
    best_score, best_control = candidates[0]
    return best_control if best_score >= 18 else None


def find_first_chat_conversation_item(window: Any, window_rect: Rect, search_box_rect: Rect | None) -> Any | None:
    conversation_region = build_chat_conversation_list_region(window_rect, search_box_rect)
    candidates: list[dict[str, Any]] = []

    for control, _depth in iter_controls(window, max_depth=14):
        rect = get_rect_tuple(control)
        if rect is None:
            continue
        if search_box_rect is not None and rect[1] < search_box_rect[3] + 8:
            continue

        score = score_chat_conversation_item_candidate(control, conversation_region)
        if score <= 0:
            continue

        candidates.append({
            "control": control,
            "score": score,
            "rect": rect,
            "centerY": rect_center(rect)[1],
            "width": rect[2] - rect[0],
        })

    if not candidates:
        return None

    candidates.sort(key=lambda item: (item["centerY"], item["rect"][0]))
    rows: list[dict[str, Any]] = []
    for candidate in candidates:
        existing_row = next((row for row in rows if abs(row["centerY"] - candidate["centerY"]) <= 12), None)
        if existing_row is None:
            rows.append(candidate)
            continue

        if (candidate["score"], candidate["width"]) > (existing_row["score"], existing_row["width"]):
            existing_row.update(candidate)

    rows.sort(key=lambda item: (item["centerY"], -item["score"], item["rect"][0]))
    return rows[0]["control"] if rows else None


def score_plus_candidate(control: Any, window_rect: Rect, search_rect: Rect | None = None) -> int:
    name = control_name(control)
    type_name = control_type(control)
    class_name = control_class(control)
    rect = get_rect_tuple(control)
    score = 0

    if type_name == "ButtonControl":
        score += 6
    elif type_name in {"PaneControl", "GroupControl"}:
        score += 3
    if "button" in class_name.lower():
        score += 2

    if QUICK_ACTION_NAME in name:
        score += 28
    if "快捷" in name:
        score += 12
    if "更多" in name:
        score += 14
    if "功能" in name:
        score += 8
    if "菜单" in name:
        score += 6
    if name in {"+", "＋"}:
        score += 12
    if ADD_FRIEND_NAME in name:
        score -= 12

    if rect:
        if is_top_right(rect, window_rect):
            score += 7
        width = rect[2] - rect[0]
        height = rect[3] - rect[1]
        if 18 <= width <= 90 and 18 <= height <= 90:
            score += 2
        if search_rect:
            if rect[0] >= search_rect[2] - 4:
                score += 10
            if is_same_row(rect, search_rect, tolerance=22):
                score += 10
            if rect[0] < search_rect[0]:
                score -= 18
            if rect[2] <= search_rect[2]:
                score -= 12
            gap = rect[0] - search_rect[2]
            if 0 <= gap <= 120:
                score += 10
            elif gap > 240:
                score -= 6

    return score


def find_named_control_in_window(
    window: Any,
    target_names: tuple[str, ...],
    *,
    allowed_types: tuple[str, ...] = ("ButtonControl", "PaneControl", "GroupControl", "TextControl"),
    max_depth: int = 20,
) -> Any | None:
    normalized_targets = {name.strip() for name in target_names if name.strip()}
    if not normalized_targets:
        return None

    for control, _depth in iter_controls(window, max_depth=max_depth):
        if control_type(control) not in allowed_types:
            continue
        if control_name(control) in normalized_targets:
            return control
    return None


def find_exact_button_by_name(
    window: Any,
    name: str,
    search_depth: int = 24,
    *,
    exists_timeout: float = 0.3,
) -> Any | None:
    button_factory = getattr(window, "ButtonControl", None)
    if not callable(button_factory):
        return None
    try:
        control = button_factory(Name=name, searchDepth=search_depth)
    except Exception:
        return None
    return control if control.Exists(exists_timeout) else None


def find_plus_button(window: Any) -> Any:
    window_rect = get_rect_tuple(window)
    if not window_rect:
        raise RuntimeError("无法读取微信窗口坐标，无法定位快捷操作按钮")

    exact_quick_action = find_exact_button_by_name(window, QUICK_ACTION_NAME, search_depth=8, exists_timeout=0.05)
    if exact_quick_action is None:
        exact_quick_action = find_exact_button_by_name(window, QUICK_ACTION_NAME)
    if exact_quick_action is None:
        exact_quick_action = find_named_control_in_window(window, (QUICK_ACTION_NAME,))
    if exact_quick_action is not None:
        rect = get_rect_tuple(exact_quick_action)
        if rect is not None and is_top_toolbar_button(rect, window_rect):
            return exact_quick_action

    search_box = find_search_box(window, window_rect)
    search_rect = get_rect_tuple(search_box) if search_box is not None else None

    candidates: list[tuple[int, Any]] = []
    for control, _depth in iter_controls(window, max_depth=6):
        rect = get_rect_tuple(control)
        if rect is None or not is_top_toolbar_button(rect, window_rect):
            continue
        if search_rect is not None:
            if rect[0] < search_rect[2] - 4:
                continue
            if not is_same_row(rect, search_rect, tolerance=22):
                continue
        score = score_plus_candidate(control, window_rect, search_rect)
        if score > 0:
            candidates.append((score, control))

    if not candidates:
        raise RuntimeError("未找到搜索框右侧的快捷操作按钮候选控件")

    candidates.sort(key=lambda item: item[0], reverse=True)
    best_score, best_control = candidates[0]
    if best_score < 18:
        summaries = "; ".join(describe_control(control) for _, control in candidates[:5])
        raise RuntimeError(f"未能可靠识别搜索框右侧的快捷操作按钮，候选控件: {summaries}")
    return best_control


def collect_quick_action_button_probe(window: Any) -> tuple[ProbeNode | None, list[ProbeNode]]:
    window_rect = get_rect_tuple(window)
    if not window_rect:
        raise RuntimeError("无法读取微信窗口坐标，无法探测快捷操作按钮")

    search_box = find_search_box(window, window_rect)
    search_rect = get_rect_tuple(search_box) if search_box is not None else None
    candidates: list[tuple[int, int, Any]] = []

    exact_quick_action = find_exact_button_by_name(window, QUICK_ACTION_NAME, search_depth=8, exists_timeout=0.05)
    if exact_quick_action is None:
        exact_quick_action = find_exact_button_by_name(window, QUICK_ACTION_NAME)
    if exact_quick_action is None:
        exact_quick_action = find_named_control_in_window(window, (QUICK_ACTION_NAME,))
    if exact_quick_action is not None:
        rect = get_rect_tuple(exact_quick_action)
        if rect is not None:
            score = score_plus_candidate(exact_quick_action, window_rect, search_rect)
            if is_top_toolbar_button(rect, window_rect):
                score += 20
            candidates.append((score, 0, exact_quick_action))

    for control, depth in iter_controls(window, max_depth=8):
        rect = get_rect_tuple(control)
        if rect is None or not is_top_toolbar_button(rect, window_rect):
            continue

        score = score_plus_candidate(control, window_rect, search_rect)
        if control_name(control) == QUICK_ACTION_NAME:
            score += 20
        if search_rect is not None:
            if rect[0] >= search_rect[2] - 4 and is_same_row(rect, search_rect, tolerance=22):
                score += 8
            elif control_name(control) != QUICK_ACTION_NAME:
                score -= 16
        if score <= 0:
            continue
        candidates.append((score, depth, control))

    seen: set[str] = set()
    nodes: list[ProbeNode] = []
    for score, depth, control in sorted(candidates, key=lambda item: item[0], reverse=True):
        payload = serialize_probe_node(control, depth, "window")
        payload["score"] = score
        dedupe_key = json.dumps(payload, ensure_ascii=False, sort_keys=True)
        if dedupe_key in seen:
            continue
        seen.add(dedupe_key)
        nodes.append(payload)

    best = nodes[0] if nodes else None
    return best, nodes[:20]


def find_quick_action_list(window: Any, search_depth: int = 24, exists_timeout: float = 0.3) -> Any | None:
    list_factory = getattr(window, "ListControl", None)
    if callable(list_factory):
        try:
            control = list_factory(Name=QUICK_ACTION_NAME, searchDepth=search_depth)
        except Exception:
            control = None
        if control is not None and control.Exists(exists_timeout):
            return control

    for control, _depth in iter_controls(window, max_depth=search_depth):
        if control_type(control) == "ListControl" and control_name(control) == QUICK_ACTION_NAME:
            return control
    return None


def score_add_friend_candidate(control: Any) -> int:
    name = control_name(control)
    if ADD_FRIEND_NAME not in name:
        return 0

    type_name = control_type(control)
    score = 20
    if type_name == "MenuItemControl":
        score += 8
    elif type_name in {"ButtonControl", "ListItemControl"}:
        score += 5
    elif type_name == "TextControl":
        score += 2

    if control_class(control):
        score += 1
    return score


def collect_add_friend_candidates(auto: Any, window: Any, window_rect: Rect, menu_region: Rect) -> list[tuple[int, Any]]:
    candidates: list[tuple[int, Any]] = []
    for scope, max_depth in ((window, 6), (auto.GetRootControl(), 8)):
        for control, _depth in iter_controls(scope, max_depth=max_depth):
            if not is_control_in_wechat_region(control, window_rect, menu_region):
                continue
            score = score_add_friend_candidate(control)
            if score > 0:
                candidates.append((score, control))

    candidates.sort(key=lambda item: item[0], reverse=True)
    return candidates


def try_find_exact_add_friend_entry(auto: Any, window: Any, window_rect: Rect, menu_region: Rect) -> Any | None:
    quick_action_list = find_quick_action_list(window)
    if quick_action_list is not None:
        list_item_factory = getattr(quick_action_list, "ListItemControl", None)
        if callable(list_item_factory):
            try:
                control = list_item_factory(Name=ADD_FRIEND_NAME, searchDepth=8)
            except Exception:
                control = None
            if control is not None and control.Exists(0.3):
                rect = get_rect_tuple(control)
                if rect is not None and rect_center_within(rect, window_rect, tolerance=24):
                    return control

        for control, _depth in iter_controls(quick_action_list, max_depth=8):
            if control_type(control) != "ListItemControl":
                continue
            if control_name(control) != ADD_FRIEND_NAME:
                continue
            rect = get_rect_tuple(control)
            if rect is not None and rect_center_within(rect, window_rect, tolerance=24):
                return control

    factories = (
        getattr(auto, "MenuItemControl", None),
        getattr(auto, "ButtonControl", None),
        getattr(auto, "ListItemControl", None),
        getattr(auto, "TextControl", None),
    )
    for factory in factories:
        if not callable(factory):
            continue
        control = factory(searchDepth=16, Name=ADD_FRIEND_NAME)
        if control.Exists(0.3) and is_control_in_wechat_region(control, window_rect, menu_region):
            return control
    return None


def describe_related_controls(auto: Any, window: Any, window_rect: Rect, menu_region: Rect) -> str:
    snippets: list[str] = []
    seen: set[str] = set()

    for scope, max_depth in ((window, 6), (auto.GetRootControl(), 6)):
        for control, _depth in iter_controls(scope, max_depth=max_depth):
            if not is_control_in_wechat_region(control, window_rect, menu_region):
                continue
            name = control_name(control)
            if not name or (ADD_FRIEND_NAME not in name and "朋友" not in name):
                continue
            summary = describe_control(control)
            if summary in seen:
                continue
            seen.add(summary)
            snippets.append(summary)
            if len(snippets) >= 6:
                return "; ".join(snippets)

    return "; ".join(snippets)


def find_add_friend_entry(auto: Any, window: Any, window_rect: Rect, menu_region: Rect) -> Any:
    exact_match = try_find_exact_add_friend_entry(auto, window, window_rect, menu_region)
    if exact_match is not None:
        return exact_match

    candidates = collect_add_friend_candidates(auto, window, window_rect, menu_region)
    if candidates:
        return candidates[0][1]

    related_controls = describe_related_controls(auto, window, window_rect, menu_region)
    if related_controls:
        raise RuntimeError(f"未找到“添加朋友”入口，相关控件: {related_controls}")
    raise RuntimeError("未找到“添加朋友”入口")


def collect_add_friend_menu_probe(auto: Any, window: Any, window_name: str) -> tuple[Rect, ProbeNode, list[ProbeNode]]:
    plus_button = find_plus_button(window)
    plus_rect = get_rect_tuple(plus_button)

    window_rect = get_rect_tuple(window)
    if not window_rect:
        raise RuntimeError("无法读取微信窗口坐标，无法探测加号菜单")

    menu_region = build_menu_probe_region(window_rect, plus_rect)
    related_controls: list[ProbeNode] = []
    seen: set[str] = set()

    def collect_from_scope(scope: Any, source: str, max_depth: int) -> None:
        for control, depth in iter_controls(scope, max_depth=max_depth):
            if not should_include_probe_control(control, window_rect, menu_region):
                continue
            payload = serialize_probe_node(control, depth, source)
            dedupe_key = json.dumps(payload, ensure_ascii=False, sort_keys=True)
            if dedupe_key in seen:
                continue
            seen.add(dedupe_key)
            related_controls.append(payload)

    collect_from_scope(window, "window", 6)
    collect_from_scope(auto.GetRootControl(), "root", 8)
    related_controls.sort(
        key=lambda item: (
            0 if item["name"] == ADD_FRIEND_NAME else 1,
            0 if item["controlType"] == "MenuItemControl" else 1,
            item["depth"],
            item["name"],
        )
    )
    return menu_region, serialize_probe_node(plus_button, 0, "window"), related_controls[:60]


def find_add_friend_window(auto: Any) -> Any | None:
    from .constants import ADD_FRIEND_NAME
    from .uia import find_named_window

    return find_named_window(auto, (ADD_FRIEND_NAME,))


def find_request_friend_window(auto: Any) -> Any | None:
    from .uia import find_named_window

    return find_named_window(auto, (REQUEST_FRIEND_NAME,))


def find_add_friend_search_box(window: Any) -> Any | None:
    edit_factory = getattr(window, "EditControl", None)
    if callable(edit_factory):
        for found_index in range(1, 4):
            try:
                control = edit_factory(searchDepth=16, foundIndex=found_index)
            except Exception:
                control = None
            if control is not None and control.Exists(0.2):
                rect = get_rect_tuple(control)
                window_rect = get_rect_tuple(window)
                if rect is not None and window_rect is not None and rect_center_within(rect, window_rect, tolerance=24):
                    return control

    window_rect = get_rect_tuple(window)
    if window_rect is None:
        return None

    candidates: list[tuple[int, Any]] = []
    for control, _depth in iter_controls(window, max_depth=12):
        type_name = control_type(control)
        rect = get_rect_tuple(control)
        if rect is None:
            continue
        score = 0
        if type_name == "EditControl":
            score += 20
        elif type_name in {"PaneControl", "GroupControl"}:
            score += 4
        if not rect_center_within(rect, window_rect, tolerance=24):
            continue
        if rect[1] <= window_rect[1] + int((window_rect[3] - window_rect[1]) * 0.35):
            score += 6
        width = rect[2] - rect[0]
        height = rect[3] - rect[1]
        if 160 <= width <= 520:
            score += 6
        if 24 <= height <= 56:
            score += 4
        name = control_name(control)
        if "搜索" in name or "search" in name.lower():
            score += 12
        if score > 0:
            candidates.append((score, control))

    if not candidates:
        return None
    candidates.sort(key=lambda item: item[0], reverse=True)
    best_score, best_control = candidates[0]
    return best_control if best_score >= 12 else None


def find_best_action_control(
    control: Any,
    *,
    exact_names: tuple[str, ...] = (),
    partial_names: tuple[str, ...] = (),
    preferred_types: tuple[str, ...] = ("ButtonControl", "ListItemControl", "TextControl"),
    max_depth: int = 14,
    within_rect: Rect | None = None,
    prefer_lower_half: bool = False,
    prefer_right_half: bool = False,
) -> tuple[Any | None, list[Any]]:
    candidates: list[tuple[int, Any]] = []

    for item in iter_descendants(control, max_depth=max_depth):
        name = control_name(item)
        type_name = control_type(item)
        rect = get_rect_tuple(item)
        if within_rect is not None and (rect is None or not rect_center_within(rect, within_rect, tolerance=24)):
            continue

        score = 0
        if name in exact_names:
            score += 30
        for partial_name in partial_names:
            if partial_name and partial_name in name:
                score += 16
        if score <= 0:
            continue

        if type_name in preferred_types:
            score += 8
        elif type_name in {"PaneControl", "GroupControl", "CustomControl"}:
            score += 3

        if rect is not None and within_rect is not None:
            width = rect[2] - rect[0]
            height = rect[3] - rect[1]
            region_width = max(within_rect[2] - within_rect[0], 1)
            region_height = max(within_rect[3] - within_rect[1], 1)
            center_x, center_y = rect_center(rect)
            if prefer_right_half and center_x >= within_rect[0] + int(region_width * 0.52):
                score += 4
            if prefer_lower_half and center_y >= within_rect[1] + int(region_height * 0.45):
                score += 4
            if 60 <= width <= 260:
                score += 3
            if 24 <= height <= 72:
                score += 2

        candidates.append((score, item))

    candidates.sort(key=lambda item: item[0], reverse=True)
    if not candidates:
        return None, []
    return candidates[0][1], [item[1] for item in candidates]


def find_request_greeting_editor(window: Any) -> Any | None:
    window_rect = get_rect_tuple(window)
    if window_rect is None:
        return None

    label_rect = None
    for control, _depth in iter_controls(window, max_depth=12):
        name = control_name(control)
        if name == REQUEST_LABEL_NAME or REQUEST_LABEL_NAME in name:
            label_rect = get_rect_tuple(control)
            if label_rect is not None:
                break

    candidates: list[tuple[int, Any]] = []
    for control, _depth in iter_controls(window, max_depth=14):
        if control_type(control) not in {"EditControl", "DocumentControl"}:
            continue
        rect = get_rect_tuple(control)
        if rect is None or not rect_center_within(rect, window_rect, tolerance=24):
            continue

        score = 20
        if rect[1] >= window_rect[1] + int((window_rect[3] - window_rect[1]) * 0.30):
            score += 8

        width = rect[2] - rect[0]
        height = rect[3] - rect[1]
        if 180 <= width <= 640:
            score += 6
        if 50 <= height <= 260:
            score += 6
        if height >= 60:
            score += 6

        name = control_name(control)
        if "打招呼" in name or "我是" in name or "验证" in name:
            score += 12

        if label_rect is not None:
            if rect[1] >= label_rect[3] - 8:
                score += 18
            if rect[1] - label_rect[3] <= 140:
                score += 6
            if abs(rect[0] - label_rect[0]) <= 80:
                score += 4

        candidates.append((score, control))

    if not candidates:
        return None
    candidates.sort(key=lambda item: item[0], reverse=True)
    best_score, best_control = candidates[0]
    return best_control if best_score >= 22 else None


def find_request_greeting_editor_from_root(auto: Any, request_window: Any) -> Any | None:
    request_rect = get_rect_tuple(request_window)
    root = auto.GetRootControl()
    label_rect = None

    if request_rect is not None:
        for control, _depth in iter_controls(root, max_depth=10):
            rect = get_rect_tuple(control)
            if rect is None or not rect_center_within(rect, request_rect, tolerance=48):
                continue
            name = control_name(control)
            if name == REQUEST_LABEL_NAME or REQUEST_LABEL_NAME in name:
                label_rect = rect
                break

    candidates: list[tuple[int, Any]] = []
    for control, _depth in iter_controls(root, max_depth=10):
        if control_type(control) not in {"EditControl", "DocumentControl"}:
            continue
        rect = get_rect_tuple(control)
        if rect is None:
            continue

        score = 18
        if request_rect is not None and rect_center_within(rect, request_rect, tolerance=48):
            score += 10

        width = rect[2] - rect[0]
        height = rect[3] - rect[1]
        if 180 <= width <= 720:
            score += 6
        if 50 <= height <= 260:
            score += 6
        if height >= 60:
            score += 6

        name = control_name(control)
        if "打招呼" in name or "我是" in name or "验证" in name:
            score += 12

        if label_rect is not None:
            if rect[1] >= label_rect[3] - 8:
                score += 18
            if rect[1] - label_rect[3] <= 140:
                score += 6
            if abs(rect[0] - label_rect[0]) <= 80:
                score += 4

        candidates.append((score, control))

    candidates.sort(key=lambda item: item[0], reverse=True)
    if not candidates:
        return None
    best_score, best_control = candidates[0]
    return best_control if best_score >= 22 else None


def click_add_to_contacts(auto: Any, window: Any) -> tuple[Any | None, list[Any]]:
    factories = [
        (getattr(window, "ButtonControl", None), {"Name": ADD_TO_CONTACTS_NAME, "searchDepth": 18}),
        (getattr(window, "ListItemControl", None), {"Name": ADD_TO_CONTACTS_NAME, "searchDepth": 18}),
        (getattr(window, "TextControl", None), {"Name": ADD_TO_CONTACTS_NAME, "searchDepth": 18}),
    ]
    control = click_first_existing(factories)
    if control is not None:
        return control, [control]

    window_rect = get_rect_tuple(window)
    best_in_window, window_candidates = find_best_action_control(
        window,
        exact_names=(ADD_TO_CONTACTS_NAME,),
        partial_names=(ADD_TO_CONTACTS_NAME,),
        max_depth=18,
        within_rect=window_rect,
        prefer_lower_half=True,
        prefer_right_half=True,
    )
    if best_in_window is not None:
        best_in_window.Click(simulateMove=False)
        return best_in_window, window_candidates

    root = auto.GetRootControl()
    root_factories = [
        (getattr(root, "ButtonControl", None), {"Name": ADD_TO_CONTACTS_NAME, "searchDepth": 24}),
    ]
    control = click_first_existing(root_factories)
    if control is not None:
        return control, [control]

    best_from_root, root_candidates = find_best_action_control(
        root,
        exact_names=(ADD_TO_CONTACTS_NAME,),
        partial_names=(ADD_TO_CONTACTS_NAME,),
        max_depth=24,
        within_rect=window_rect,
        prefer_lower_half=True,
        prefer_right_half=True,
    )
    if best_from_root is not None:
        best_from_root.Click(simulateMove=False)
        return best_from_root, root_candidates

    fallback_from_root, fallback_candidates = find_best_action_control(
        root,
        exact_names=(ADD_TO_CONTACTS_NAME,),
        partial_names=(ADD_TO_CONTACTS_NAME,),
        max_depth=24,
        prefer_lower_half=True,
        prefer_right_half=True,
    )
    if fallback_from_root is not None:
        fallback_from_root.Click(simulateMove=False)
        return fallback_from_root, fallback_candidates

    return None, window_candidates + root_candidates + fallback_candidates


def click_send_request(auto: Any, window: Any) -> tuple[Any | None, list[Any]]:
    factories = [
        (getattr(window, "ButtonControl", None), {"Name": "发送", "searchDepth": 18}),
        (getattr(window, "ButtonControl", None), {"Name": "发送申请", "searchDepth": 18}),
        (getattr(window, "ButtonControl", None), {"Name": "确认", "searchDepth": 18}),
        (getattr(window, "ButtonControl", None), {"Name": "确定", "searchDepth": 18}),
        (getattr(window, "TextControl", None), {"Name": "发送", "searchDepth": 18}),
    ]
    control = click_first_existing(factories)
    if control is not None:
        return control, [control]

    window_rect = get_rect_tuple(window)
    best_in_window, window_candidates = find_best_action_control(
        window,
        exact_names=("发送", "发送申请", "确认", "确定"),
        partial_names=("发送", "申请", "确认", "确定"),
        max_depth=18,
        within_rect=window_rect,
        prefer_lower_half=True,
        prefer_right_half=True,
    )
    if best_in_window is not None:
        best_in_window.Click(simulateMove=False)
        return best_in_window, window_candidates

    root = auto.GetRootControl()
    best_from_root, root_candidates = find_best_action_control(
        root,
        exact_names=("发送", "发送申请", "确认", "确定"),
        partial_names=("发送", "申请", "确认", "确定"),
        max_depth=24,
        within_rect=window_rect,
        prefer_lower_half=True,
        prefer_right_half=True,
    )
    if best_from_root is not None:
        best_from_root.Click(simulateMove=False)
        return best_from_root, root_candidates

    fallback_from_root, fallback_candidates = find_best_action_control(
        root,
        exact_names=("发送", "发送申请", "确认", "确定"),
        partial_names=("发送", "申请", "确认", "确定"),
        max_depth=24,
        prefer_lower_half=True,
        prefer_right_half=True,
    )
    if fallback_from_root is not None:
        fallback_from_root.Click(simulateMove=False)
        return fallback_from_root, fallback_candidates

    return None, window_candidates + root_candidates + fallback_candidates


def click_add_to_contacts_strict(auto: Any, window: Any) -> tuple[Any | None, list[Any]]:
    window_rect = get_rect_tuple(window)
    factories = [
        (getattr(window, "ButtonControl", None), {"Name": ADD_TO_CONTACTS_NAME, "searchDepth": 18}),
        (getattr(window, "ListItemControl", None), {"Name": ADD_TO_CONTACTS_NAME, "searchDepth": 18}),
        (getattr(window, "TextControl", None), {"Name": ADD_TO_CONTACTS_NAME, "searchDepth": 18}),
    ]
    control = click_first_existing(factories)
    if control is not None:
        return control, [control]

    best_in_window, window_candidates = find_best_action_control(
        window,
        exact_names=(ADD_TO_CONTACTS_NAME,),
        partial_names=(ADD_TO_CONTACTS_NAME,),
        max_depth=18,
        within_rect=window_rect,
        prefer_lower_half=True,
        prefer_right_half=True,
    )
    if best_in_window is not None:
        best_in_window.Click(simulateMove=False)
        return best_in_window, window_candidates

    root = auto.GetRootControl()
    root_factories = [
        (getattr(root, "ButtonControl", None), {"Name": ADD_TO_CONTACTS_NAME, "searchDepth": 24}),
        (getattr(root, "ListItemControl", None), {"Name": ADD_TO_CONTACTS_NAME, "searchDepth": 24}),
        (getattr(root, "TextControl", None), {"Name": ADD_TO_CONTACTS_NAME, "searchDepth": 24}),
    ]
    for factory, kwargs in root_factories:
        if not callable(factory):
            continue
        try:
            control = factory(**kwargs)
        except Exception:
            continue
        if not control.Exists(0.1):
            continue
        rect = get_rect_tuple(control)
        if window_rect is not None and rect is not None and rect_center_within(rect, window_rect, tolerance=24):
            control.Click(simulateMove=False)
            return control, [control]

    best_from_root, root_candidates = find_best_action_control(
        root,
        exact_names=(ADD_TO_CONTACTS_NAME,),
        partial_names=(ADD_TO_CONTACTS_NAME,),
        max_depth=24,
        within_rect=window_rect,
        prefer_lower_half=True,
        prefer_right_half=True,
    )
    if best_from_root is not None:
        best_from_root.Click(simulateMove=False)
        return best_from_root, root_candidates

    return None, window_candidates + root_candidates


def find_chat_message_editor(window: Any) -> Any | None:
    window_rect = get_rect_tuple(window)
    if window_rect is None:
        return None

    win_width = max(window_rect[2] - window_rect[0], 1)
    win_height = max(window_rect[3] - window_rect[1], 1)
    candidates: list[tuple[int, Any]] = []

    for control, _depth in iter_controls(window, max_depth=16):
        type_name = control_type(control)
        if type_name not in {"EditControl", "DocumentControl"}:
            continue

        rect = get_rect_tuple(control)
        if rect is None or not rect_center_within(rect, window_rect, tolerance=24):
            continue

        width = rect[2] - rect[0]
        height = rect[3] - rect[1]
        center_x, center_y = rect_center(rect)
        name = control_name(control)
        if name == "搜索" or "搜索" in name:
            continue
        if center_y < window_rect[1] + int(win_height * 0.55):
            continue
        if center_x < window_rect[0] + int(win_width * 0.28):
            continue
        if height < 40:
            continue
        score = 34 if type_name == "EditControl" else 8

        if center_y >= window_rect[1] + int(win_height * 0.58):
            score += 14
        if center_x >= window_rect[0] + int(win_width * 0.20):
            score += 4
        if width >= max(220, int(win_width * 0.28)):
            score += 8
        if 40 <= height <= 220:
            score += 8
        elif height > int(win_height * 0.45):
            score -= 30
        if height >= 60:
            score += 4

        if "输入" in name or "消息" in name or "chat" in name.lower() or "message" in name.lower():
            score += 8

        candidates.append((score, control))

    if not candidates:
        return None
    candidates.sort(key=lambda item: item[0], reverse=True)
    best_score, best_control = candidates[0]
    return best_control if best_score >= 24 else None


def find_chat_message_editor_from_root(auto: Any, window: Any) -> Any | None:
    window_rect = get_rect_tuple(window)
    if window_rect is None:
        return None

    root = auto.GetRootControl()
    win_width = max(window_rect[2] - window_rect[0], 1)
    win_height = max(window_rect[3] - window_rect[1], 1)
    candidates: list[tuple[int, Any]] = []

    for control, _depth in iter_controls(root, max_depth=12):
        type_name = control_type(control)
        if type_name not in {"EditControl", "DocumentControl"}:
            continue

        rect = get_rect_tuple(control)
        if rect is None or not rect_center_within(rect, window_rect, tolerance=48):
            continue

        width = rect[2] - rect[0]
        height = rect[3] - rect[1]
        center_x, center_y = rect_center(rect)
        name = control_name(control)
        if name == "搜索" or "搜索" in name:
            continue
        if center_y < window_rect[1] + int(win_height * 0.55):
            continue
        if center_x < window_rect[0] + int(win_width * 0.28):
            continue
        if height < 40:
            continue
        score = 34 if type_name == "EditControl" else 8

        if center_y >= window_rect[1] + int(win_height * 0.58):
            score += 14
        if center_x >= window_rect[0] + int(win_width * 0.20):
            score += 4
        if width >= max(220, int(win_width * 0.28)):
            score += 8
        if 40 <= height <= 220:
            score += 8
        elif height > int(win_height * 0.45):
            score -= 30
        if height >= 60:
            score += 4

        if "输入" in name or "消息" in name or "chat" in name.lower() or "message" in name.lower():
            score += 8

        candidates.append((score, control))

    if not candidates:
        return None
    candidates.sort(key=lambda item: item[0], reverse=True)
    best_score, best_control = candidates[0]
    return best_control if best_score >= 24 else None


def click_add_to_contacts(auto: Any, window: Any) -> tuple[Any | None, list[Any]]:
    factories = [
        (getattr(window, "ButtonControl", None), {"Name": ADD_TO_CONTACTS_NAME, "searchDepth": 18}),
        (getattr(window, "ListItemControl", None), {"Name": ADD_TO_CONTACTS_NAME, "searchDepth": 18}),
        (getattr(window, "TextControl", None), {"Name": ADD_TO_CONTACTS_NAME, "searchDepth": 18}),
    ]
    control = click_first_existing(factories)
    if control is not None:
        return control, [control]

    window_rect = get_rect_tuple(window)
    best_in_window, window_candidates = find_best_action_control(
        window,
        exact_names=(ADD_TO_CONTACTS_NAME,),
        partial_names=(ADD_TO_CONTACTS_NAME, ADD_FRIEND_NAME, "添加"),
        max_depth=18,
        within_rect=window_rect,
        prefer_lower_half=True,
        prefer_right_half=True,
    )
    if best_in_window is not None:
        best_in_window.Click(simulateMove=False)
        return best_in_window, window_candidates

    root = auto.GetRootControl()
    root_factories = [
        (getattr(root, "ButtonControl", None), {"Name": ADD_TO_CONTACTS_NAME, "searchDepth": 24}),
        (getattr(root, "ButtonControl", None), {"Name": ADD_FRIEND_NAME, "searchDepth": 24}),
    ]
    control = click_first_existing(root_factories)
    if control is not None:
        return control, [control]

    best_from_root, root_candidates = find_best_action_control(
        root,
        exact_names=(ADD_TO_CONTACTS_NAME, ADD_FRIEND_NAME),
        partial_names=(ADD_TO_CONTACTS_NAME, ADD_FRIEND_NAME, "添加"),
        max_depth=24,
        within_rect=window_rect,
        prefer_lower_half=True,
        prefer_right_half=True,
    )
    if best_from_root is not None:
        best_from_root.Click(simulateMove=False)
        return best_from_root, root_candidates

    fallback_from_root, fallback_candidates = find_best_action_control(
        root,
        exact_names=(ADD_TO_CONTACTS_NAME, ADD_FRIEND_NAME),
        partial_names=(ADD_TO_CONTACTS_NAME, ADD_FRIEND_NAME),
        max_depth=24,
        prefer_lower_half=True,
        prefer_right_half=True,
    )
    if fallback_from_root is not None:
        fallback_from_root.Click(simulateMove=False)
        return fallback_from_root, fallback_candidates

    return None, window_candidates + root_candidates + fallback_candidates


def click_send_message(auto: Any, window: Any) -> tuple[Any | None, list[Any]]:
    factories = [
        (getattr(window, "ButtonControl", None), {"Name": SEND_MESSAGE_NAME, "searchDepth": 18}),
        (getattr(window, "ListItemControl", None), {"Name": SEND_MESSAGE_NAME, "searchDepth": 18}),
        (getattr(window, "TextControl", None), {"Name": SEND_MESSAGE_NAME, "searchDepth": 18}),
    ]
    control = click_first_existing(factories)
    if control is not None:
        return control, [control]

    window_rect = get_rect_tuple(window)
    best_in_window, window_candidates = find_best_action_control(
        window,
        exact_names=(SEND_MESSAGE_NAME,),
        partial_names=(SEND_MESSAGE_NAME, "消息"),
        max_depth=18,
        within_rect=window_rect,
        prefer_lower_half=True,
        prefer_right_half=True,
    )
    if best_in_window is not None:
        best_in_window.Click(simulateMove=False)
        return best_in_window, window_candidates

    root = auto.GetRootControl()
    best_from_root, root_candidates = find_best_action_control(
        root,
        exact_names=(SEND_MESSAGE_NAME,),
        partial_names=(SEND_MESSAGE_NAME, "消息"),
        max_depth=24,
        within_rect=window_rect,
        prefer_lower_half=True,
        prefer_right_half=True,
    )
    if best_from_root is not None:
        best_from_root.Click(simulateMove=False)
        return best_from_root, root_candidates

    fallback_from_root, fallback_candidates = find_best_action_control(
        root,
        exact_names=(SEND_MESSAGE_NAME,),
        partial_names=(SEND_MESSAGE_NAME, "消息"),
        max_depth=24,
        prefer_lower_half=True,
        prefer_right_half=True,
    )
    if fallback_from_root is not None:
        fallback_from_root.Click(simulateMove=False)
        return fallback_from_root, fallback_candidates

    return None, window_candidates + root_candidates + fallback_candidates


def find_send_message_button_strict(window: Any) -> tuple[Any | None, list[Any]]:
    factories = [
        (getattr(window, "ButtonControl", None), {"Name": SEND_MESSAGE_NAME, "searchDepth": 18}),
        (getattr(window, "ListItemControl", None), {"Name": SEND_MESSAGE_NAME, "searchDepth": 18}),
        (getattr(window, "TextControl", None), {"Name": SEND_MESSAGE_NAME, "searchDepth": 18}),
    ]
    for factory, kwargs in factories:
        if not callable(factory):
            continue
        try:
            control = factory(**kwargs)
        except Exception:
            continue
        if control.Exists(0.2):
            return control, [control]

    window_rect = get_rect_tuple(window)
    best_in_window, window_candidates = find_best_action_control(
        window,
        exact_names=(SEND_MESSAGE_NAME,),
        partial_names=(),
        max_depth=18,
        within_rect=window_rect,
        prefer_lower_half=True,
        prefer_right_half=True,
    )
    return best_in_window, window_candidates


def find_add_friend_result_actions(window: Any) -> dict[str, Any]:
    window_rect = get_rect_tuple(window)
    actions: dict[str, Any] = {
        "send_message": None,
        "add_to_contacts": None,
        "candidates": [],
    }
    if window_rect is None:
        return actions

    for control, _depth in iter_controls(window, max_depth=18):
        type_name = control_type(control)
        if type_name not in {"ButtonControl", "ListItemControl", "TextControl"}:
            continue

        name = control_name(control)
        if name not in {SEND_MESSAGE_NAME, ADD_TO_CONTACTS_NAME}:
            continue

        rect = get_rect_tuple(control)
        if rect is None or not rect_center_within(rect, window_rect, tolerance=24):
            continue

        actions["candidates"].append(control)
        if name == SEND_MESSAGE_NAME and actions["send_message"] is None:
            actions["send_message"] = control
        elif name == ADD_TO_CONTACTS_NAME and actions["add_to_contacts"] is None:
            actions["add_to_contacts"] = control

    return actions


def click_send_request(auto: Any, window: Any) -> tuple[Any | None, list[Any]]:
    factories = [
        (getattr(window, "ButtonControl", None), {"Name": "发送", "searchDepth": 18}),
        (getattr(window, "ButtonControl", None), {"Name": "发送申请", "searchDepth": 18}),
        (getattr(window, "ButtonControl", None), {"Name": "确认", "searchDepth": 18}),
        (getattr(window, "ButtonControl", None), {"Name": "确定", "searchDepth": 18}),
        (getattr(window, "TextControl", None), {"Name": "发送", "searchDepth": 18}),
    ]
    control = click_first_existing(factories)
    if control is not None:
        return control, [control]

    window_rect = get_rect_tuple(window)
    best_in_window, window_candidates = find_best_action_control(
        window,
        exact_names=("发送", "发送申请", "确认", "确定"),
        partial_names=("发送", "申请", "确认", "确定"),
        max_depth=18,
        within_rect=window_rect,
        prefer_lower_half=True,
        prefer_right_half=True,
    )
    if best_in_window is not None:
        best_in_window.Click(simulateMove=False)
        return best_in_window, window_candidates

    root = auto.GetRootControl()
    best_from_root, root_candidates = find_best_action_control(
        root,
        exact_names=("发送", "发送申请", "确认", "确定"),
        partial_names=("发送", "申请", "确认", "确定"),
        max_depth=24,
        within_rect=window_rect,
        prefer_lower_half=True,
        prefer_right_half=True,
    )
    if best_from_root is not None:
        best_from_root.Click(simulateMove=False)
        return best_from_root, root_candidates

    fallback_from_root, fallback_candidates = find_best_action_control(
        root,
        exact_names=("发送", "发送申请", "确认", "确定"),
        partial_names=("发送", "申请", "确认", "确定"),
        max_depth=24,
        prefer_lower_half=True,
        prefer_right_half=True,
    )
    if fallback_from_root is not None:
        fallback_from_root.Click(simulateMove=False)
        return fallback_from_root, fallback_candidates

    return None, window_candidates + root_candidates + fallback_candidates

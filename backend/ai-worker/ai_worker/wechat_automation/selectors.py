from __future__ import annotations

import json
from typing import Any

from .constants import (
    ADD_FRIEND_NAME,
    ADD_TO_CONTACTS_NAME,
    QUICK_ACTION_NAME,
    REQUEST_FRIEND_NAME,
    REQUEST_LABEL_NAME,
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


def find_exact_button_by_name(window: Any, name: str, search_depth: int = 24) -> Any | None:
    button_factory = getattr(window, "ButtonControl", None)
    if not callable(button_factory):
        return None
    try:
        control = button_factory(Name=name, searchDepth=search_depth)
    except Exception:
        return None
    return control if control.Exists(0.3) else None


def find_plus_button(window: Any) -> Any:
    window_rect = get_rect_tuple(window)
    if not window_rect:
        raise RuntimeError("无法读取微信窗口坐标，无法定位快捷操作按钮")

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


def find_quick_action_list(window: Any, search_depth: int = 24) -> Any | None:
    list_factory = getattr(window, "ListControl", None)
    if callable(list_factory):
        try:
            control = list_factory(Name=QUICK_ACTION_NAME, searchDepth=search_depth)
        except Exception:
            control = None
        if control is not None and control.Exists(0.3):
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
        (getattr(window, "ButtonControl", None), {"Name": ADD_FRIEND_NAME, "searchDepth": 18}),
        (getattr(window, "ListItemControl", None), {"Name": ADD_TO_CONTACTS_NAME, "searchDepth": 18}),
        (getattr(window, "ListItemControl", None), {"Name": ADD_FRIEND_NAME, "searchDepth": 18}),
        (getattr(window, "TextControl", None), {"Name": ADD_TO_CONTACTS_NAME, "searchDepth": 18}),
    ]
    control = click_first_existing(factories)
    if control is not None:
        return control, [control]

    window_rect = get_rect_tuple(window)
    best_in_window, window_candidates = find_best_action_control(
        window,
        exact_names=(ADD_TO_CONTACTS_NAME, ADD_FRIEND_NAME),
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

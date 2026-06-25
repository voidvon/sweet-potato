#!/usr/bin/env python3
"""WeChat UI Automation helper."""

from __future__ import annotations

import argparse
import json
import sys
import time
from typing import Any, Callable, Iterable

DEFAULT_WINDOW_NAME = "\u5fae\u4fe1"
QUICK_ACTION_NAME = "\u5feb\u6377\u64cd\u4f5c"
ADD_FRIEND_NAME = "\u6dfb\u52a0\u670b\u53cb"
REQUEST_FRIEND_NAME = "\u7533\u8bf7\u6dfb\u52a0\u670b\u53cb"
REQUEST_LABEL_NAME = "\u53d1\u9001\u6dfb\u52a0\u670b\u53cb\u7533\u8bf7"


def emit(payload: dict[str, Any]) -> int:
    data = json.dumps(payload, ensure_ascii=False)
    sys.stdout.buffer.write(data.encode("utf-8"))
    sys.stdout.buffer.write(b"\n")
    sys.stdout.flush()
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="WeChat automation with uiautomation")
    subparsers = parser.add_subparsers(dest="command", required=True)

    probe_parser = subparsers.add_parser("probe", help="Probe top-level child controls")
    probe_parser.add_argument("--window-name", default=DEFAULT_WINDOW_NAME, help="Target window title")

    add_friend_parser = subparsers.add_parser("open-add-friend", help="Open add-friend entry from plus menu")
    add_friend_parser.add_argument("--window-name", default=DEFAULT_WINDOW_NAME, help="Target window title")
    add_friend_parser.add_argument("--account", required=True, help="Wechat id or phone number")
    add_friend_parser.add_argument("--greeting", required=True, help="Greeting content")

    probe_add_friend_parser = subparsers.add_parser(
        "probe-add-friend-menu",
        help="Open plus menu and inspect related controls",
    )
    probe_add_friend_parser.add_argument("--window-name", default=DEFAULT_WINDOW_NAME, help="Target window title")

    send_parser = subparsers.add_parser("send-message", help="Search contact and send a message")
    send_parser.add_argument("--window-name", default=DEFAULT_WINDOW_NAME, help="Target window title")
    send_parser.add_argument("--contact-name", required=True, help="Target contact name")
    send_parser.add_argument("--message", required=True, help="Message text to send")

    return parser


def load_auto():
    try:
        import uiautomation as auto
    except Exception as error:  # pragma: no cover - environment dependent
        raise RuntimeError(f"\u5bfc\u5165 uiautomation \u5931\u8d25: {error}") from error
    return auto


def find_window(auto: Any, window_name: str):
    window = auto.WindowControl(searchDepth=1, Name=window_name)
    if not window.Exists(3):
        raise RuntimeError(f"\u672a\u627e\u5230\u7a97\u53e3: {window_name}")
    return window


def probe_window(auto: Any, window_name: str) -> dict[str, Any]:
    window = find_window(auto, window_name)
    children = []
    for child in window.GetChildren():
        children.append({
            "name": getattr(child, "Name", "") or "",
            "automationId": getattr(child, "AutomationId", "") or "",
            "className": getattr(child, "ClassName", "") or "",
            "controlType": getattr(child, "ControlTypeName", "") or "",
        })
    return {
        "windowName": window_name,
        "childCount": len(children),
        "children": children,
    }


def append_log(logs: list[dict[str, str]], level: str, message: str) -> None:
    logs.append({
        "level": level,
        "message": message,
    })


def iter_controls(control: Any, depth: int = 0, max_depth: int = 5) -> Iterable[tuple[Any, int]]:
    if depth > max_depth:
        return

    for child in control.GetChildren():
        yield child, depth
        yield from iter_controls(child, depth + 1, max_depth)


def get_rect_tuple(control: Any) -> tuple[int, int, int, int] | None:
    rect = getattr(control, "BoundingRectangle", None)
    if callable(rect):
        rect = rect()
    if rect is None and hasattr(control, "GetBoundingRectangle"):
        rect = control.GetBoundingRectangle()
    if rect is None:
        return None

    left = getattr(rect, "left", getattr(rect, "Left", None))
    top = getattr(rect, "top", getattr(rect, "Top", None))
    right = getattr(rect, "right", getattr(rect, "Right", None))
    bottom = getattr(rect, "bottom", getattr(rect, "Bottom", None))
    if None in (left, top, right, bottom):
        return None
    return int(left), int(top), int(right), int(bottom)


def control_name(control: Any) -> str:
    return (getattr(control, "Name", "") or "").strip()


def control_type(control: Any) -> str:
    return (getattr(control, "ControlTypeName", "") or "").strip()


def control_class(control: Any) -> str:
    return (getattr(control, "ClassName", "") or "").strip()


def describe_control(control: Any) -> str:
    rect = get_rect_tuple(control)
    rect_text = f" rect={rect}" if rect else ""
    return (
        f"name={control_name(control)!r}"
        f" type={control_type(control)!r}"
        f" class={control_class(control)!r}{rect_text}"
    )


def serialize_probe_node(control: Any, depth: int, source: str) -> dict[str, Any]:
    return {
        "name": control_name(control),
        "automationId": getattr(control, "AutomationId", "") or "",
        "className": control_class(control),
        "controlType": control_type(control),
        "depth": depth,
        "source": source,
        "rect": get_rect_tuple(control),
    }


def rect_intersects(a: tuple[int, int, int, int], b: tuple[int, int, int, int]) -> bool:
    return not (a[2] < b[0] or a[0] > b[2] or a[3] < b[1] or a[1] > b[3])


def rect_center(rect: tuple[int, int, int, int]) -> tuple[int, int]:
    return ((rect[0] + rect[2]) // 2, (rect[1] + rect[3]) // 2)


def rect_center_within(
    rect: tuple[int, int, int, int],
    container: tuple[int, int, int, int],
    tolerance: int = 0,
) -> bool:
    center_x, center_y = rect_center(rect)
    return (
        container[0] - tolerance <= center_x <= container[2] + tolerance
        and container[1] - tolerance <= center_y <= container[3] + tolerance
    )


def build_menu_probe_region(
    window_rect: tuple[int, int, int, int],
    plus_rect: tuple[int, int, int, int] | None,
) -> tuple[int, int, int, int]:
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


def is_control_in_wechat_region(
    control: Any,
    window_rect: tuple[int, int, int, int],
    menu_region: tuple[int, int, int, int],
) -> bool:
    rect = get_rect_tuple(control)
    if not rect:
        return False

    return rect_center_within(rect, window_rect, tolerance=16) and rect_intersects(rect, menu_region)


def should_include_probe_control(
    control: Any,
    window_rect: tuple[int, int, int, int],
    menu_region: tuple[int, int, int, int],
) -> bool:
    name = control_name(control)
    type_name = control_type(control)
    class_name = control_class(control)
    rect = get_rect_tuple(control)

    if "添加" in name or "朋友" in name or "好友" in name:
        return True
    if type_name in {"MenuControl", "MenuItemControl"}:
        return True
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


def is_top_right(rect: tuple[int, int, int, int], window_rect: tuple[int, int, int, int]) -> bool:
    left, top, right, bottom = rect
    win_left, win_top, win_right, win_bottom = window_rect
    width = max(win_right - win_left, 1)
    height = max(win_bottom - win_top, 1)
    return left >= win_left + int(width * 0.62) and top <= win_top + int(height * 0.22)


def score_plus_candidate(control: Any, window_rect: tuple[int, int, int, int]) -> int:
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

    if "更多" in name:
        score += 14
    if "功能" in name:
        score += 8
    if "菜单" in name:
        score += 6
    if name in {"+", "＋"}:
        score += 12
    if "添加朋友" in name:
        score -= 12

    if rect:
        if is_top_right(rect, window_rect):
            score += 7
        width = rect[2] - rect[0]
        height = rect[3] - rect[1]
        if 18 <= width <= 90 and 18 <= height <= 90:
            score += 2

    return score


def find_plus_button(window: Any) -> Any:
    window_rect = get_rect_tuple(window)
    if not window_rect:
        raise RuntimeError("无法读取微信窗口坐标，无法定位右上角加号按钮")

    candidates: list[tuple[int, Any]] = []
    for control, _depth in iter_controls(window, max_depth=5):
        score = score_plus_candidate(control, window_rect)
        if score > 0:
            candidates.append((score, control))

    if not candidates:
        raise RuntimeError("未找到右上角加号按钮候选控件")

    candidates.sort(key=lambda item: item[0], reverse=True)
    best_score, best_control = candidates[0]
    if best_score < 8:
        summaries = "; ".join(describe_control(control) for _, control in candidates[:3])
        raise RuntimeError(f"未能可靠识别右上角加号按钮，候选控件: {summaries}")
    return best_control


def score_add_friend_candidate(control: Any) -> int:
    name = control_name(control)
    if "添加朋友" not in name:
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


def collect_add_friend_candidates(auto: Any, window: Any) -> list[tuple[int, Any]]:
    candidates: list[tuple[int, Any]] = []

    for control, _depth in iter_controls(window, max_depth=6):
        score = score_add_friend_candidate(control)
        if score > 0:
            candidates.append((score, control))

    root = auto.GetRootControl()
    for control, _depth in iter_controls(root, max_depth=8):
        score = score_add_friend_candidate(control)
        if score > 0:
            candidates.append((score, control))

    candidates.sort(key=lambda item: item[0], reverse=True)
    return candidates


def try_find_exact_add_friend_entry(auto: Any) -> Any | None:
    factories = (
        getattr(auto, "MenuItemControl", None),
        getattr(auto, "ButtonControl", None),
        getattr(auto, "ListItemControl", None),
        getattr(auto, "TextControl", None),
    )

    for factory in factories:
        if not callable(factory):
            continue
        control = factory(searchDepth=12, Name="添加朋友")
        if control.Exists(0.2):
            return control

    return None


def wait_for_match(search_fn: Callable[[], Any | None], timeout: float = 3.0, interval: float = 0.2) -> Any | None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            match = search_fn()
        except Exception:
            match = None
        if match is not None:
            return match
        time.sleep(interval)
    return None


def describe_related_controls(auto: Any, window: Any) -> str:
    snippets: list[str] = []
    seen: set[str] = set()

    for scope, max_depth in ((window, 6), (auto.GetRootControl(), 6)):
        for control, _depth in iter_controls(scope, max_depth=max_depth):
            name = control_name(control)
            if not name or ("添加" not in name and "朋友" not in name and "好友" not in name):
                continue
            summary = describe_control(control)
            if summary in seen:
                continue
            seen.add(summary)
            snippets.append(summary)
            if len(snippets) >= 6:
                return "; ".join(snippets)

    return "; ".join(snippets)


def find_add_friend_entry(auto: Any, window: Any) -> Any:
    exact_match = try_find_exact_add_friend_entry(auto)
    if exact_match is not None:
        return exact_match

    candidates = collect_add_friend_candidates(auto, window)
    if candidates:
        return candidates[0][1]

    related_controls = describe_related_controls(auto, window)
    if related_controls:
        raise RuntimeError(f"未找到“添加朋友”入口，相关控件: {related_controls}")
    raise RuntimeError("未找到“添加朋友”入口")


def collect_add_friend_menu_probe(auto: Any, window_name: str) -> tuple[list[dict[str, str]], dict[str, Any]]:
    logs: list[dict[str, str]] = []
    window = find_window(auto, window_name)
    append_log(logs, "info", f"\u5df2\u627e\u5230\u5fae\u4fe1\u7a97\u53e3: {window_name}")

    window.SetActive()
    time.sleep(0.3)
    append_log(logs, "info", "\u5df2\u6fc0\u6d3b\u5fae\u4fe1\u7a97\u53e3")

    plus_button = find_plus_button(window)
    plus_rect = get_rect_tuple(plus_button)
    append_log(logs, "info", f"\u5df2\u5b9a\u4f4d\u53f3\u4e0a\u89d2\u52a0\u53f7\u6309\u94ae: {describe_control(plus_button)}")

    plus_button.Click(simulateMove=False)
    time.sleep(0.6)
    append_log(logs, "info", "\u5df2\u70b9\u51fb\u53f3\u4e0a\u89d2\u52a0\u53f7\u6309\u94ae\uff0c\u5f00\u59cb\u63a2\u6d4b\u5f39\u51fa\u83dc\u5355")

    window_rect = get_rect_tuple(window)
    if not window_rect:
        raise RuntimeError("无法读取微信窗口坐标，无法探测加号菜单")

    menu_region = build_menu_probe_region(window_rect, plus_rect)
    related_controls: list[dict[str, Any]] = []
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
            0 if item["name"] == "添加朋友" else 1,
            0 if item["controlType"] == "MenuItemControl" else 1,
            item["depth"],
            item["name"],
        )
    )
    append_log(logs, "info", f"\u5df2\u91c7\u96c6\u5230 {len(related_controls)} \u4e2a\u76f8\u5173\u63a7\u4ef6")

    return logs, {
        "windowName": window_name,
        "plusButton": serialize_probe_node(plus_button, 0, "window"),
        "relatedControls": related_controls[:80],
    }


def open_add_friend(auto: Any, window_name: str) -> list[dict[str, str]]:
    logs: list[dict[str, str]] = []
    window = find_window(auto, window_name)
    append_log(logs, "info", f"\u5df2\u627e\u5230\u5fae\u4fe1\u7a97\u53e3: {window_name}")

    window.SetActive()
    time.sleep(0.3)
    append_log(logs, "info", "\u5df2\u6fc0\u6d3b\u5fae\u4fe1\u7a97\u53e3")

    plus_button = find_plus_button(window)
    append_log(logs, "info", f"\u5df2\u5b9a\u4f4d\u53f3\u4e0a\u89d2\u52a0\u53f7\u6309\u94ae: {describe_control(plus_button)}")

    add_friend_entry = None
    for attempt in range(2):
        plus_button.Click(simulateMove=False)
        time.sleep(0.5)
        append_log(logs, "info", "\u5df2\u70b9\u51fb\u53f3\u4e0a\u89d2\u52a0\u53f7\u6309\u94ae")

        add_friend_entry = wait_for_match(
            lambda: find_add_friend_entry(auto, window),
            timeout=2.5,
            interval=0.2,
        )
        if add_friend_entry is not None:
            break

        if attempt == 0:
            append_log(logs, "warn", "\u9996\u6b21\u672a\u627e\u5230\u201c\u6dfb\u52a0\u670b\u53cb\u201d\uff0c\u51c6\u5907\u91cd\u8bd5\u70b9\u51fb\u52a0\u53f7")
            plus_button = find_plus_button(window)

    if add_friend_entry is None:
        add_friend_entry = find_add_friend_entry(auto, window)

    append_log(logs, "info", f"\u5df2\u627e\u5230\u201c\u6dfb\u52a0\u670b\u53cb\u201d\u5165\u53e3: {describe_control(add_friend_entry)}")
    add_friend_entry.Click(simulateMove=False)
    time.sleep(0.5)
    append_log(logs, "info", "\u5df2\u70b9\u51fb\u201c\u6dfb\u52a0\u670b\u53cb\u201d")
    return logs


def should_include_probe_control(
    control: Any,
    window_rect: tuple[int, int, int, int],
    menu_region: tuple[int, int, int, int],
) -> bool:
    name = control_name(control)
    type_name = control_type(control)
    class_name = control_class(control)
    rect = get_rect_tuple(control)

    if "添加" in name or "朋友" in name or "好友" in name:
        return rect is not None and rect_center_within(rect, window_rect, tolerance=16)
    if "快捷操作" in name:
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


def score_plus_candidate(control: Any, window_rect: tuple[int, int, int, int]) -> int:
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

    if "快捷操作" in name:
        score += 18
    if "快捷" in name:
        score += 8
    if "更多" in name:
        score += 14
    if "功能" in name:
        score += 8
    if "菜单" in name:
        score += 6
    if name in {"+", "＋"}:
        score += 12
    if "添加朋友" in name:
        score -= 12

    if rect:
        if is_top_right(rect, window_rect):
            score += 7
        width = rect[2] - rect[0]
        height = rect[3] - rect[1]
        if 18 <= width <= 90 and 18 <= height <= 90:
            score += 2

    return score


def collect_add_friend_candidates(
    auto: Any,
    window: Any,
    window_rect: tuple[int, int, int, int],
    menu_region: tuple[int, int, int, int],
) -> list[tuple[int, Any]]:
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


def try_find_exact_add_friend_entry(
    auto: Any,
    window_rect: tuple[int, int, int, int],
    menu_region: tuple[int, int, int, int],
) -> Any | None:
    factories = (
        getattr(auto, "MenuItemControl", None),
        getattr(auto, "ButtonControl", None),
        getattr(auto, "ListItemControl", None),
        getattr(auto, "TextControl", None),
    )

    for factory in factories:
        if not callable(factory):
            continue
        control = factory(searchDepth=12, Name="添加朋友")
        if control.Exists(0.2) and is_control_in_wechat_region(control, window_rect, menu_region):
            return control

    return None


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
        if control_type(control) != "ListControl":
            continue
        if control_name(control) == QUICK_ACTION_NAME:
            return control
    return None


def score_add_friend_candidate(control: Any) -> int:
    name = control_name(control)
    if ADD_FRIEND_NAME not in name:
        return 0

    type_name = control_type(control)
    score = 20
    if type_name == "ListItemControl":
        score += 12
    elif type_name == "MenuItemControl":
        score += 8
    elif type_name == "ButtonControl":
        score += 5
    elif type_name == "TextControl":
        score += 2

    if control_class(control):
        score += 1
    return score


def try_find_exact_add_friend_entry(
    auto: Any,
    window_rect: tuple[int, int, int, int],
    menu_region: tuple[int, int, int, int],
) -> Any | None:
    window = find_window(auto, DEFAULT_WINDOW_NAME)
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
        getattr(auto, "ListItemControl", None),
        getattr(auto, "MenuItemControl", None),
        getattr(auto, "ButtonControl", None),
        getattr(auto, "TextControl", None),
    )

    for factory in factories:
        if not callable(factory):
            continue
        control = factory(searchDepth=16, Name=ADD_FRIEND_NAME)
        if control.Exists(0.3) and is_control_in_wechat_region(control, window_rect, menu_region):
            return control

    return None


def describe_related_controls(
    auto: Any,
    window: Any,
    window_rect: tuple[int, int, int, int],
    menu_region: tuple[int, int, int, int],
) -> str:
    snippets: list[str] = []
    seen: set[str] = set()

    for scope, max_depth in ((window, 6), (auto.GetRootControl(), 6)):
        for control, _depth in iter_controls(scope, max_depth=max_depth):
            if not is_control_in_wechat_region(control, window_rect, menu_region):
                continue
            name = control_name(control)
            if not name or ("添加" not in name and "朋友" not in name and "好友" not in name):
                continue
            summary = describe_control(control)
            if summary in seen:
                continue
            seen.add(summary)
            snippets.append(summary)
            if len(snippets) >= 6:
                return "; ".join(snippets)

    return "; ".join(snippets)


def find_add_friend_entry(
    auto: Any,
    window: Any,
    window_rect: tuple[int, int, int, int],
    menu_region: tuple[int, int, int, int],
) -> Any:
    exact_match = try_find_exact_add_friend_entry(auto, window_rect, menu_region)
    if exact_match is not None:
        return exact_match

    candidates = collect_add_friend_candidates(auto, window, window_rect, menu_region)
    if candidates:
        return candidates[0][1]

    related_controls = describe_related_controls(auto, window, window_rect, menu_region)
    if related_controls:
        raise RuntimeError(f"未找到“添加朋友”入口，相关控件: {related_controls}")
    raise RuntimeError("未找到“添加朋友”入口")


def collect_add_friend_menu_probe(auto: Any, window_name: str) -> tuple[list[dict[str, str]], dict[str, Any]]:
    logs: list[dict[str, str]] = []
    window = find_window(auto, window_name)
    append_log(logs, "info", f"\u5df2\u627e\u5230\u5fae\u4fe1\u7a97\u53e3: {window_name}")

    window.SetActive()
    time.sleep(0.3)
    append_log(logs, "info", "\u5df2\u6fc0\u6d3b\u5fae\u4fe1\u7a97\u53e3")

    plus_button = find_plus_button(window)
    plus_rect = get_rect_tuple(plus_button)
    append_log(logs, "info", f"\u5df2\u5b9a\u4f4d\u53f3\u4e0a\u89d2\u52a0\u53f7\u6309\u94ae: {describe_control(plus_button)}")

    plus_button.Click(simulateMove=False)
    time.sleep(0.6)
    append_log(logs, "info", "\u5df2\u70b9\u51fb\u53f3\u4e0a\u89d2\u52a0\u53f7\u6309\u94ae\uff0c\u5f00\u59cb\u63a2\u6d4b\u5f39\u51fa\u83dc\u5355")

    window_rect = get_rect_tuple(window)
    if not window_rect:
        raise RuntimeError("无法读取微信窗口坐标，无法探测加号菜单")

    menu_region = build_menu_probe_region(window_rect, plus_rect)
    append_log(logs, "info", f"已限制探测范围为微信窗口内菜单区域: {menu_region}")
    related_controls: list[dict[str, Any]] = []
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
            0 if item["name"] == "添加朋友" else 1,
            0 if item["controlType"] == "MenuItemControl" else 1,
            item["depth"],
            item["name"],
        )
    )
    append_log(logs, "info", f"\u5df2\u91c7\u96c6\u5230 {len(related_controls)} \u4e2a\u76f8\u5173\u63a7\u4ef6")

    return logs, {
        "windowName": window_name,
        "menuRegion": menu_region,
        "plusButton": serialize_probe_node(plus_button, 0, "window"),
        "relatedControls": related_controls[:60],
    }


def open_add_friend(auto: Any, window_name: str) -> list[dict[str, str]]:
    logs: list[dict[str, str]] = []
    window = find_window(auto, window_name)
    append_log(logs, "info", f"\u5df2\u627e\u5230\u5fae\u4fe1\u7a97\u53e3: {window_name}")

    window.SetActive()
    time.sleep(0.3)
    append_log(logs, "info", "\u5df2\u6fc0\u6d3b\u5fae\u4fe1\u7a97\u53e3")

    plus_button = find_plus_button(window)
    append_log(logs, "info", f"\u5df2\u5b9a\u4f4d\u53f3\u4e0a\u89d2\u52a0\u53f7\u6309\u94ae: {describe_control(plus_button)}")

    window_rect = get_rect_tuple(window)
    if not window_rect:
        raise RuntimeError("无法读取微信窗口坐标，无法定位添加朋友入口")

    plus_rect = get_rect_tuple(plus_button)
    menu_region = build_menu_probe_region(window_rect, plus_rect)
    append_log(logs, "info", f"已限制查找范围为微信窗口内菜单区域: {menu_region}")

    add_friend_entry = None
    for attempt in range(2):
        plus_button.Click(simulateMove=False)
        time.sleep(0.5)
        append_log(logs, "info", "\u5df2\u70b9\u51fb\u53f3\u4e0a\u89d2\u52a0\u53f7\u6309\u94ae")

        add_friend_entry = wait_for_match(
            lambda: find_add_friend_entry(auto, window, window_rect, menu_region),
            timeout=2.5,
            interval=0.2,
        )
        if add_friend_entry is not None:
            break

        if attempt == 0:
            append_log(logs, "warn", "\u9996\u6b21\u672a\u627e\u5230\u201c\u6dfb\u52a0\u670b\u53cb\u201d\uff0c\u51c6\u5907\u91cd\u8bd5\u70b9\u51fb\u52a0\u53f7")
            plus_button = find_plus_button(window)
            plus_rect = get_rect_tuple(plus_button)
            menu_region = build_menu_probe_region(window_rect, plus_rect)

    if add_friend_entry is None:
        add_friend_entry = find_add_friend_entry(auto, window, window_rect, menu_region)

    append_log(logs, "info", f"\u5df2\u627e\u5230\u201c\u6dfb\u52a0\u670b\u53cb\u201d\u5165\u53e3: {describe_control(add_friend_entry)}")
    add_friend_entry.Click(simulateMove=False)
    time.sleep(0.5)
    append_log(logs, "info", "\u5df2\u70b9\u51fb\u201c\u6dfb\u52a0\u670b\u53cb\u201d")
    return logs


def is_same_row(
    rect: tuple[int, int, int, int],
    anchor_rect: tuple[int, int, int, int],
    tolerance: int = 18,
) -> bool:
    rect_center_y = (rect[1] + rect[3]) // 2
    anchor_center_y = (anchor_rect[1] + anchor_rect[3]) // 2
    return abs(rect_center_y - anchor_center_y) <= tolerance


def score_search_candidate(control: Any, window_rect: tuple[int, int, int, int]) -> int:
    name = control_name(control)
    type_name = control_type(control)
    rect = get_rect_tuple(control)
    score = 0

    if rect is None:
        return 0

    left, top, right, bottom = rect
    width = right - left
    height = bottom - top
    win_left, win_top, win_right, win_bottom = window_rect
    win_width = max(win_right - win_left, 1)
    win_height = max(win_bottom - win_top, 1)

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


def is_top_toolbar_button(
    rect: tuple[int, int, int, int],
    window_rect: tuple[int, int, int, int],
) -> bool:
    left, top, right, bottom = rect
    win_left, win_top, win_right, win_bottom = window_rect
    win_height = max(win_bottom - win_top, 1)
    width = right - left
    height = bottom - top

    if top > win_top + int(win_height * 0.22):
        return False
    if width < 18 or width > 72 or height < 18 or height > 64:
        return False
    if left < win_left or right > win_right:
        return False
    return True


def find_search_box(window: Any, window_rect: tuple[int, int, int, int]) -> Any | None:
    candidates: list[tuple[int, Any]] = []
    for control, _depth in iter_controls(window, max_depth=6):
        score = score_search_candidate(control, window_rect)
        if score > 0:
            candidates.append((score, control))

    if not candidates:
        return None

    candidates.sort(key=lambda item: item[0], reverse=True)
    best_score, best_control = candidates[0]
    if best_score < 10:
        return None
    return best_control


def score_plus_candidate(
    control: Any,
    window_rect: tuple[int, int, int, int],
    search_rect: tuple[int, int, int, int] | None = None,
) -> int:
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

    if "快捷操作" in name:
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
    if "添加朋友" in name:
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


def find_plus_button(window: Any) -> Any:
    window_rect = get_rect_tuple(window)
    if not window_rect:
        raise RuntimeError("无法读取微信窗口坐标，无法定位快捷操作按钮")

    search_box = find_search_box(window, window_rect)
    search_rect = get_rect_tuple(search_box) if search_box is not None else None

    candidates: list[tuple[int, Any]] = []
    for control, _depth in iter_controls(window, max_depth=6):
        score = score_plus_candidate(control, window_rect, search_rect)
        if score > 0:
            candidates.append((score, control))

    if not candidates:
        raise RuntimeError("未找到搜索框右侧的快捷操作按钮候选控件")

    candidates.sort(key=lambda item: item[0], reverse=True)
    best_score, best_control = candidates[0]
    if best_score < 12:
        summaries = "; ".join(describe_control(control) for _, control in candidates[:5])
        raise RuntimeError(f"未能可靠识别搜索框右侧的快捷操作按钮，候选控件: {summaries}")
    return best_control


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

    if control.Exists(0.3):
        return control
    return None


def find_plus_button(window: Any) -> Any:
    window_rect = get_rect_tuple(window)
    if not window_rect:
        raise RuntimeError("无法读取微信窗口坐标，无法定位快捷操作按钮")

    exact_quick_action = find_named_control_in_window(window, ("快捷操作",))
    if exact_quick_action is not None:
        return exact_quick_action

    search_box = find_search_box(window, window_rect)
    search_rect = get_rect_tuple(search_box) if search_box is not None else None

    candidates: list[tuple[int, Any]] = []
    for control, _depth in iter_controls(window, max_depth=6):
        rect = get_rect_tuple(control)
        if rect is None:
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
        if rect is None:
            continue
        if not is_top_toolbar_button(rect, window_rect):
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


def try_find_exact_add_friend_entry(
    auto: Any,
    window_rect: tuple[int, int, int, int],
    menu_region: tuple[int, int, int, int],
) -> Any | None:
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


def send_message(auto: Any, window_name: str, contact_name: str, message_text: str) -> list[dict[str, str]]:
    logs: list[dict[str, str]] = []
    window = find_window(auto, window_name)
    append_log(logs, "info", f"\u5df2\u627e\u5230\u5fae\u4fe1\u7a97\u53e3: {window_name}")

    window.SetActive()
    time.sleep(0.3)
    append_log(logs, "info", "\u5df2\u6fc0\u6d3b\u5fae\u4fe1\u7a97\u53e3")

    auto.SendKeys("^f")
    time.sleep(0.4)
    append_log(logs, "info", "\u5df2\u6253\u5f00\u641c\u7d22\u6846")

    auto.SendKeys("^a")
    time.sleep(0.1)
    auto.SendKeys("{Del}")
    time.sleep(0.1)
    auto.SendKeys(contact_name)
    time.sleep(0.5)
    append_log(logs, "info", f"\u5df2\u8f93\u5165\u8054\u7cfb\u4eba\u5173\u952e\u8bcd: {contact_name}")

    auto.SendKeys("{Enter}")
    time.sleep(0.6)
    append_log(logs, "info", "\u5df2\u5c1d\u8bd5\u6253\u5f00\u8054\u7cfb\u4eba\u4f1a\u8bdd")

    edit = window.EditControl(foundIndex=1)
    if not edit.Exists(3):
        raise RuntimeError(
            "\u672a\u627e\u5230\u6d88\u606f\u8f93\u5165\u6846\uff0c"
            "\u8bf7\u5148\u7528\u63a2\u6d4b\u529f\u80fd\u786e\u8ba4\u5fae\u4fe1 UIA \u7ed3\u6784"
        )

    edit.Click()
    time.sleep(0.2)
    append_log(logs, "info", "\u5df2\u805a\u7126\u6d88\u606f\u8f93\u5165\u6846")

    auto.SendKeys("^a")
    time.sleep(0.1)
    edit.SendKeys(message_text)
    time.sleep(0.2)
    append_log(logs, "info", "\u5df2\u5199\u5165\u6d88\u606f\u5185\u5bb9")

    auto.SendKeys("{Enter}")
    append_log(logs, "info", "\u5df2\u89e6\u53d1\u53d1\u9001")
    return logs


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    try:
        auto = load_auto()
        if args.command == "probe":
            return emit({
                "ok": True,
                "data": probe_window(auto, args.window_name),
            })
        if args.command == "open-add-friend":
            logs = open_add_friend(auto, args.window_name, args.account, args.greeting)
            return emit({
                "ok": True,
                "message": "\u5df2\u6267\u884c\u6253\u5f00\u6dfb\u52a0\u670b\u53cb\u6d41\u7a0b",
                "logs": logs,
            })
        if args.command == "probe-add-friend-menu":
            logs, data = collect_add_friend_menu_probe(auto, args.window_name)
            return emit({
                "ok": True,
                "message": "\u5df2\u91c7\u96c6\u52a0\u53f7\u83dc\u5355\u63a7\u4ef6\u4fe1\u606f",
                "logs": logs,
                "data": data,
            })
        if args.command == "send-message":
            logs = send_message(auto, args.window_name, args.contact_name, args.message)
            return emit({
                "ok": True,
                "message": "\u6d88\u606f\u53d1\u9001\u6d41\u7a0b\u5df2\u6267\u884c",
                "logs": logs,
            })
        return emit({
            "ok": False,
            "message": f"\u4e0d\u652f\u6301\u7684\u547d\u4ee4: {args.command}",
        })
    except Exception as error:  # pragma: no cover - environment dependent
        return emit({
            "ok": False,
            "message": f"\u6267\u884c UIA \u64cd\u4f5c\u5931\u8d25: {error}",
        })


def replace_text(auto: Any, control: Any, value: str) -> None:
    control.Click(simulateMove=False)
    time.sleep(0.2)
    value_pattern_getter = getattr(control, "GetValuePattern", None)
    if callable(value_pattern_getter):
        try:
            value_pattern = value_pattern_getter()
        except Exception:
            value_pattern = None
        if value_pattern is not None:
            set_value = getattr(value_pattern, "SetValue", None)
            if callable(set_value):
                try:
                    set_value("")
                    time.sleep(0.1)
                    set_value(value)
                    return
                except Exception:
                    pass

    direct_set_value = getattr(control, "SetValue", None)
    if callable(direct_set_value):
        try:
            direct_set_value(value)
            return
        except Exception:
            pass

    try:
        control.SendKeys(value)
        return
    except Exception:
        pass

    auto.SendKeys("{Del}")
    time.sleep(0.1)
    auto.SendKeys(value)


def click_first_existing(control_factories: list[tuple[Any, dict[str, Any]]], timeout: float = 0.3) -> Any | None:
    for factory, kwargs in control_factories:
        if not callable(factory):
            continue
        try:
            control = factory(**kwargs)
        except Exception:
            continue
        if control.Exists(timeout):
            control.Click(simulateMove=False)
            return control
    return None


def summarize_controls(controls: list[Any], limit: int = 5) -> str:
    return "; ".join(describe_control(control) for control in controls[:limit])


def iter_descendants(control: Any, max_depth: int = 12) -> Iterable[Any]:
    for child, _depth in iter_controls(control, max_depth=max_depth):
        yield child


def find_best_action_control(
    control: Any,
    *,
    exact_names: tuple[str, ...] = (),
    partial_names: tuple[str, ...] = (),
    preferred_types: tuple[str, ...] = ("ButtonControl", "ListItemControl", "TextControl"),
    max_depth: int = 14,
    within_rect: tuple[int, int, int, int] | None = None,
    prefer_lower_half: bool = False,
    prefer_right_half: bool = False,
) -> tuple[Any | None, list[Any]]:
    candidates: list[tuple[int, Any]] = []

    for item in iter_descendants(control, max_depth=max_depth):
        name = control_name(item)
        type_name = control_type(item)
        rect = get_rect_tuple(item)
        if within_rect is not None:
            if rect is None or not rect_center_within(rect, within_rect, tolerance=24):
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


def find_named_window(auto: Any, names: tuple[str, ...]) -> Any | None:
    window_factory = getattr(auto, "WindowControl", None)
    if callable(window_factory):
        for name in names:
            try:
                control = window_factory(searchDepth=3, Name=name)
            except Exception:
                control = None
            if control is not None and control.Exists(0.3):
                return control

    root = auto.GetRootControl()
    for control, _depth in iter_controls(root, max_depth=6):
        if control_type(control) != "WindowControl":
            continue
        if control_name(control) in names:
            return control
    return None


def find_add_friend_window(auto: Any) -> Any | None:
    return find_named_window(auto, (ADD_FRIEND_NAME,))


def find_request_friend_window(auto: Any) -> Any | None:
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
    if best_score < 12:
        return None
    return best_control


def find_greeting_editor(window: Any) -> Any | None:
    window_rect = get_rect_tuple(window)
    if window_rect is None:
        return None

    candidates: list[tuple[int, Any]] = []
    for control, _depth in iter_controls(window, max_depth=14):
        if control_type(control) != "EditControl":
            continue
        rect = get_rect_tuple(control)
        if rect is None:
            continue
        score = 20
        if not rect_center_within(rect, window_rect, tolerance=24):
            continue
        if rect[1] >= window_rect[1] + int((window_rect[3] - window_rect[1]) * 0.30):
            score += 8
        width = rect[2] - rect[0]
        height = rect[3] - rect[1]
        if 180 <= width <= 560:
            score += 6
        if 50 <= height <= 220:
            score += 6
        name = control_name(control)
        if "打招呼" in name or "我是" in name:
            score += 12
        candidates.append((score, control))

    if not candidates:
        return None

    candidates.sort(key=lambda item: item[0], reverse=True)
    best_score, best_control = candidates[0]
    if best_score < 20:
        return None
    return best_control


def find_greeting_editor_from_root(auto: Any, preferred_window: Any) -> Any | None:
    preferred_rect = get_rect_tuple(preferred_window)
    root = auto.GetRootControl()

    candidates: list[tuple[int, Any]] = []
    for control, _depth in iter_controls(root, max_depth=10):
        type_name = control_type(control)
        if type_name not in {"EditControl", "DocumentControl"}:
            continue
        rect = get_rect_tuple(control)
        if rect is None:
            continue

        score = 18
        if preferred_rect is not None and rect_center_within(rect, preferred_rect, tolerance=48):
            score += 10

        width = rect[2] - rect[0]
        height = rect[3] - rect[1]
        if 180 <= width <= 720:
            score += 6
        if 50 <= height <= 260:
            score += 6

        name = control_name(control)
        if "打招呼" in name or "我是" in name:
            score += 12
        if "验证" in name:
            score += 6

        candidates.append((score, control))

    candidates.sort(key=lambda item: item[0], reverse=True)
    if not candidates:
        return None

    best_score, best_control = candidates[0]
    if best_score < 22:
        return None
    return best_control


def click_add_to_contacts(auto: Any, window: Any) -> tuple[Any | None, list[Any]]:
    factories = [
        (getattr(window, "ButtonControl", None), {"Name": "添加到通讯录", "searchDepth": 18}),
        (getattr(window, "ButtonControl", None), {"Name": "添加朋友", "searchDepth": 18}),
        (getattr(window, "ListItemControl", None), {"Name": "添加到通讯录", "searchDepth": 18}),
        (getattr(window, "ListItemControl", None), {"Name": "添加朋友", "searchDepth": 18}),
        (getattr(window, "TextControl", None), {"Name": "添加到通讯录", "searchDepth": 18}),
    ]
    control = click_first_existing(factories)
    if control is not None:
        return control, [control]

    window_rect = get_rect_tuple(window)
    best_in_window, window_candidates = find_best_action_control(
        window,
        exact_names=("添加到通讯录", "添加朋友"),
        partial_names=("添加到通讯录", "添加朋友", "添加"),
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
        (getattr(root, "ButtonControl", None), {"Name": "添加到通讯录", "searchDepth": 24}),
        (getattr(root, "ButtonControl", None), {"Name": "添加朋友", "searchDepth": 24}),
    ]
    control = click_first_existing(root_factories)
    if control is not None:
        return control, [control]

    best_from_root, root_candidates = find_best_action_control(
        root,
        exact_names=("添加到通讯录", "添加朋友"),
        partial_names=("添加到通讯录", "添加朋友", "添加"),
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
        exact_names=("添加到通讯录", "添加朋友"),
        partial_names=("添加到通讯录", "添加朋友"),
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


def find_add_friend_entry(auto: Any, window: Any, window_rect: tuple[int, int, int, int], menu_region: tuple[int, int, int, int]) -> Any:
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

    exact_match = try_find_exact_add_friend_entry(auto, window_rect, menu_region)
    if exact_match is not None:
        return exact_match

    candidates = collect_add_friend_candidates(auto, window, window_rect, menu_region)
    if candidates:
        return candidates[0][1]

    related_controls = describe_related_controls(auto, window, window_rect, menu_region)
    if related_controls:
        raise RuntimeError(f"未找到“添加朋友”入口，相关控件: {related_controls}")
    raise RuntimeError("未找到“添加朋友”入口")


def open_add_friend(auto: Any, window_name: str) -> list[dict[str, str]]:
    logs: list[dict[str, str]] = []
    window = find_window(auto, window_name)
    append_log(logs, "info", f"已找到微信窗口: {window_name}")

    window.SetActive()
    time.sleep(0.3)
    append_log(logs, "info", "已激活微信窗口")

    plus_button = find_plus_button(window)
    append_log(logs, "info", f"已定位右上角加号按钮: {describe_control(plus_button)}")

    window_rect = get_rect_tuple(window)
    if not window_rect:
        raise RuntimeError("无法读取微信窗口坐标，无法定位添加朋友入口")

    plus_rect = get_rect_tuple(plus_button)
    menu_region = build_menu_probe_region(window_rect, plus_rect)
    append_log(logs, "info", f"已限制查找范围为微信窗口内菜单区域: {menu_region}")

    add_friend_entry = None
    for attempt in range(2):
        plus_button.Click(simulateMove=False)
        time.sleep(0.5)
        append_log(logs, "info", "已点击右上角加号按钮")

        add_friend_entry = wait_for_match(
            lambda: find_add_friend_entry(auto, window, window_rect, menu_region),
            timeout=2.5,
            interval=0.2,
        )
        if add_friend_entry is not None:
            break

        if attempt == 0:
            append_log(logs, "warn", "首次未找到“添加朋友”，准备重试点击加号")
            plus_button = find_plus_button(window)
            plus_rect = get_rect_tuple(plus_button)
            menu_region = build_menu_probe_region(window_rect, plus_rect)

    if add_friend_entry is None:
        add_friend_entry = find_add_friend_entry(auto, window, window_rect, menu_region)

    append_log(logs, "info", f"已找到“添加朋友”入口: {describe_control(add_friend_entry)}")
    add_friend_entry.Click(simulateMove=False)
    time.sleep(0.5)
    append_log(logs, "info", "已点击“添加朋友”")

    add_friend_window = wait_for_match(
        lambda: find_add_friend_window(auto),
        timeout=4.0,
        interval=0.2,
    )
    if add_friend_window is None:
        raise RuntimeError("点击“添加朋友”后未找到“添加朋友”窗口")

    append_log(logs, "info", f"已找到“添加朋友”窗口: {describe_control(add_friend_window)}")
    add_friend_window.SetActive()
    time.sleep(0.3)
    append_log(logs, "info", "已激活“添加朋友”窗口")

    search_box = find_add_friend_search_box(add_friend_window)
    if search_box is None:
        raise RuntimeError("未找到“添加朋友”窗口中的搜索框")

    search_box.Click(simulateMove=False)
    time.sleep(0.2)
    append_log(logs, "info", f"已聚焦搜索框: {describe_control(search_box)}")
    return logs


def open_add_friend(auto: Any, window_name: str, account: str, greeting: str) -> list[dict[str, str]]:
    logs: list[dict[str, str]] = []
    window = find_window(auto, window_name)
    append_log(logs, "info", f"已找到微信窗口: {window_name}")

    window.SetActive()
    time.sleep(0.3)
    append_log(logs, "info", "已激活微信窗口")

    plus_button = find_plus_button(window)
    append_log(logs, "info", f"已定位右上角加号按钮: {describe_control(plus_button)}")

    window_rect = get_rect_tuple(window)
    if not window_rect:
        raise RuntimeError("无法读取微信窗口坐标，无法定位添加朋友入口")

    plus_rect = get_rect_tuple(plus_button)
    menu_region = build_menu_probe_region(window_rect, plus_rect)
    append_log(logs, "info", f"已限制查找范围为微信窗口内菜单区域: {menu_region}")

    add_friend_entry = None
    for attempt in range(2):
        plus_button.Click(simulateMove=False)
        time.sleep(0.5)
        append_log(logs, "info", "已点击右上角加号按钮")

        add_friend_entry = wait_for_match(
          lambda: find_add_friend_entry(auto, window, window_rect, menu_region),
          timeout=2.5,
          interval=0.2,
        )
        if add_friend_entry is not None:
            break

        if attempt == 0:
            append_log(logs, "warn", "首次未找到“添加朋友”，准备重试点击加号")
            plus_button = find_plus_button(window)
            plus_rect = get_rect_tuple(plus_button)
            menu_region = build_menu_probe_region(window_rect, plus_rect)

    if add_friend_entry is None:
        add_friend_entry = find_add_friend_entry(auto, window, window_rect, menu_region)

    append_log(logs, "info", f"已找到“添加朋友”入口: {describe_control(add_friend_entry)}")
    add_friend_entry.Click(simulateMove=False)
    time.sleep(0.5)
    append_log(logs, "info", "已点击“添加朋友”")

    add_friend_window = wait_for_match(
        lambda: find_add_friend_window(auto),
        timeout=4.0,
        interval=0.2,
    )
    if add_friend_window is None:
        raise RuntimeError("点击“添加朋友”后未找到“添加朋友”窗口")

    append_log(logs, "info", f"已找到“添加朋友”窗口: {describe_control(add_friend_window)}")
    add_friend_window.SetActive()
    time.sleep(0.3)
    append_log(logs, "info", "已激活“添加朋友”窗口")

    search_box = find_add_friend_search_box(add_friend_window)
    if search_box is None:
        raise RuntimeError("未找到“添加朋友”窗口中的搜索框")

    replace_text(auto, search_box, account)
    append_log(logs, "info", f"已输入微信号/手机号: {account}")
    auto.SendKeys("{Enter}")
    time.sleep(0.8)
    append_log(logs, "info", "已提交账号搜索")

    add_to_contacts_candidates: list[Any] = []

    def try_click_add_to_contacts() -> Any | None:
        for target_window in (add_friend_window, window):
            control, candidates = click_add_to_contacts(auto, target_window)
            if candidates:
                add_to_contacts_candidates[:] = candidates
            if control is not None:
                return control
        return None

    add_to_contacts = wait_for_match(
        try_click_add_to_contacts,
        timeout=6.0,
        interval=0.3,
    )
    if add_to_contacts is None:
        candidate_summary = summarize_controls(add_to_contacts_candidates)
        if candidate_summary:
            raise RuntimeError(f"未找到“添加到通讯录”入口，候选控件: {candidate_summary}")
        raise RuntimeError("未找到“添加到通讯录”入口")
    append_log(logs, "info", f"已点击添加按钮: {describe_control(add_to_contacts)}")
    time.sleep(1.0)

    greeting_editor = wait_for_match(
        lambda: find_greeting_editor(add_friend_window) or find_greeting_editor_from_root(auto, add_friend_window),
        timeout=5.0,
        interval=0.2,
    )
    if greeting_editor is None:
        raise RuntimeError("未找到打招呼输入框")

    replace_text(auto, greeting_editor, greeting)
    append_log(logs, "info", f"已输入打招呼内容: {greeting}")

    send_button_candidates: list[Any] = []

    def try_click_send_request() -> Any | None:
        control, candidates = click_send_request(auto, add_friend_window)
        if candidates:
            send_button_candidates[:] = candidates
        return control

    send_button = wait_for_match(
        try_click_send_request,
        timeout=4.0,
        interval=0.2,
    )
    if send_button is None:
        auto.SendKeys("{Enter}")
        if send_button_candidates:
            append_log(logs, "warn", f"未找到发送按钮，候选控件: {summarize_controls(send_button_candidates)}；已回退为回车提交")
        else:
            append_log(logs, "warn", "未找到发送按钮，已回退为回车提交")
    else:
        append_log(logs, "info", f"已点击发送按钮: {describe_control(send_button)}")

    return logs


def find_request_friend_window(auto: Any) -> Any | None:
    return find_named_window(auto, (REQUEST_FRIEND_NAME,))


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
    if best_score < 22:
        return None
    return best_control


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
    if best_score < 22:
        return None
    return best_control


def close_window_gracefully(window: Any) -> bool:
    close_method = getattr(window, "Close", None)
    if callable(close_method):
        try:
            close_method()
            return True
        except Exception:
            pass

    window_pattern_getter = getattr(window, "GetWindowPattern", None)
    if callable(window_pattern_getter):
        try:
            window_pattern = window_pattern_getter()
        except Exception:
            window_pattern = None
        if window_pattern is not None:
            close_method = getattr(window_pattern, "Close", None)
            if callable(close_method):
                try:
                    close_method()
                    return True
                except Exception:
                    pass

    return False


def open_add_friend(auto: Any, window_name: str, account: str, greeting: str) -> list[dict[str, str]]:
    logs: list[dict[str, str]] = []
    window = find_window(auto, window_name)
    append_log(logs, "info", f"已找到微信窗口: {window_name}")

    window.SetActive()
    time.sleep(0.3)
    append_log(logs, "info", "已激活微信窗口")

    plus_button = find_plus_button(window)
    append_log(logs, "info", f"已定位右上角加号按钮: {describe_control(plus_button)}")

    window_rect = get_rect_tuple(window)
    if not window_rect:
        raise RuntimeError("无法读取微信窗口坐标，无法定位添加朋友入口")

    plus_rect = get_rect_tuple(plus_button)
    menu_region = build_menu_probe_region(window_rect, plus_rect)
    append_log(logs, "info", f"已限制查找范围为微信窗口内菜单区域: {menu_region}")

    add_friend_entry = None
    for attempt in range(2):
        plus_button.Click(simulateMove=False)
        time.sleep(0.5)
        append_log(logs, "info", "已点击右上角加号按钮")

        add_friend_entry = wait_for_match(
            lambda: find_add_friend_entry(auto, window, window_rect, menu_region),
            timeout=2.5,
            interval=0.2,
        )
        if add_friend_entry is not None:
            break

        if attempt == 0:
            append_log(logs, "warn", "首次未找到“添加朋友”，准备重试点击加号")
            plus_button = find_plus_button(window)
            plus_rect = get_rect_tuple(plus_button)
            menu_region = build_menu_probe_region(window_rect, plus_rect)

    if add_friend_entry is None:
        add_friend_entry = find_add_friend_entry(auto, window, window_rect, menu_region)

    append_log(logs, "info", f"已找到“添加朋友”入口: {describe_control(add_friend_entry)}")
    add_friend_entry.Click(simulateMove=False)
    time.sleep(0.5)
    append_log(logs, "info", "已点击“添加朋友”")

    add_friend_window = wait_for_match(
        lambda: find_add_friend_window(auto),
        timeout=4.0,
        interval=0.2,
    )
    if add_friend_window is None:
        raise RuntimeError("点击“添加朋友”后未找到“添加朋友”窗口")

    append_log(logs, "info", f"已找到“添加朋友”窗口: {describe_control(add_friend_window)}")
    add_friend_window.SetActive()
    time.sleep(0.3)
    append_log(logs, "info", "已激活“添加朋友”窗口")

    search_box = find_add_friend_search_box(add_friend_window)
    if search_box is None:
        raise RuntimeError("未找到“添加朋友”窗口中的搜索框")

    replace_text(auto, search_box, account)
    append_log(logs, "info", f"已输入微信号/手机号: {account}")
    auto.SendKeys("{Enter}")
    time.sleep(0.8)
    append_log(logs, "info", "已提交账号搜索")

    add_to_contacts_candidates: list[Any] = []

    def try_click_add_to_contacts() -> Any | None:
        for target_window in (add_friend_window, window):
            control, candidates = click_add_to_contacts(auto, target_window)
            if candidates:
                add_to_contacts_candidates[:] = candidates
            if control is not None:
                return control
        return None

    add_to_contacts = wait_for_match(
        try_click_add_to_contacts,
        timeout=6.0,
        interval=0.3,
    )
    if add_to_contacts is None:
        candidate_summary = summarize_controls(add_to_contacts_candidates)
        if candidate_summary:
            raise RuntimeError(f"未找到“添加到通讯录”入口，候选控件: {candidate_summary}")
        raise RuntimeError("未找到“添加到通讯录”入口")
    append_log(logs, "info", f"已点击添加按钮: {describe_control(add_to_contacts)}")
    time.sleep(0.8)

    request_window = wait_for_match(
        lambda: find_request_friend_window(auto),
        timeout=4.0,
        interval=0.2,
    )
    if request_window is None:
        raise RuntimeError("点击“添加到通讯录”后未找到“申请添加朋友”窗口")

    append_log(logs, "info", f"已找到“申请添加朋友”窗口: {describe_control(request_window)}")
    request_window.SetActive()
    time.sleep(0.3)
    append_log(logs, "info", "已激活“申请添加朋友”窗口")

    greeting_editor = wait_for_match(
        lambda: find_request_greeting_editor(request_window) or find_request_greeting_editor_from_root(auto, request_window),
        timeout=5.0,
        interval=0.2,
    )
    if greeting_editor is None:
        raise RuntimeError("未找到“发送添加朋友申请”下方的多行输入框")

    replace_text(auto, greeting_editor, greeting)
    append_log(logs, "info", f"已输入打招呼内容: {greeting}")

    send_button_candidates: list[Any] = []

    def try_click_send_request() -> Any | None:
        control, candidates = click_send_request(auto, request_window)
        if candidates:
            send_button_candidates[:] = candidates
        return control

    send_button = wait_for_match(
        try_click_send_request,
        timeout=4.0,
        interval=0.2,
    )
    if send_button is None:
        auto.SendKeys("{Enter}")
        if send_button_candidates:
            append_log(logs, "warn", f"未找到发送按钮，候选控件: {summarize_controls(send_button_candidates)}；已回退为回车提交")
        else:
            append_log(logs, "warn", "未找到发送按钮，已回退为回车提交")
    else:
        append_log(logs, "info", f"已点击发送按钮: {describe_control(send_button)}")

    time.sleep(0.8)

    if close_window_gracefully(request_window):
        append_log(logs, "info", "已关闭“申请添加朋友”窗口")
        time.sleep(0.3)
    else:
        append_log(logs, "warn", "未能自动关闭“申请添加朋友”窗口")

    add_friend_window_still_open = wait_for_match(
        lambda: find_add_friend_window(auto),
        timeout=1.0,
        interval=0.2,
    )
    if add_friend_window_still_open is not None and close_window_gracefully(add_friend_window_still_open):
        append_log(logs, "info", "已关闭“添加朋友”窗口")
        time.sleep(0.3)

    window.SetActive()
    time.sleep(0.2)
    append_log(logs, "info", "已返回主微信窗口")

    return logs


if __name__ == "__main__":
    raise SystemExit(main())

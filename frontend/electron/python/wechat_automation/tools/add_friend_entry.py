from __future__ import annotations

from typing import Any

from ..models import AutomationLog
from ..selectors import find_add_friend_entry, find_add_friend_window
from ..uia import activate_window, append_log, click_control, describe_control, find_window, get_rect_tuple, serialize_probe_node, wait_for_match
from .quick_action import open_quick_action_menu


def click_add_friend_entry(auto: Any, window_name: str) -> tuple[list[AutomationLog], dict[str, Any]]:
    logs: list[AutomationLog] = []
    window = find_window(auto, window_name)
    append_log(logs, "info", f"已找到微信窗口: {window_name}", code="window_found", details={"windowName": window_name})

    activate_window(window)
    append_log(logs, "info", "已激活微信窗口，准备打开快捷操作菜单", code="window_activated")

    _quick_action_button, menu_region, quick_action_data = open_quick_action_menu(
        auto,
        window,
        window_name,
        logs,
        context_code_prefix="click_add_friend_quick_action",
    )
    if not quick_action_data.get("menuOpened"):
        raise RuntimeError("未能打开快捷操作菜单，无法继续点击“添加朋友”")

    window_rect = get_rect_tuple(window)
    if not window_rect:
        raise RuntimeError("无法读取微信窗口坐标，无法定位添加朋友入口")

    add_friend_entry = wait_for_match(
        lambda: find_add_friend_entry(auto, window, window_rect, menu_region),
        timeout=1.2,
        interval=0.08,
    )
    if add_friend_entry is None:
        raise RuntimeError("已点击“快捷操作”按钮，但未找到“添加朋友”入口")

    add_friend_summary = describe_control(add_friend_entry)
    append_log(
        logs,
        "info",
        f"已找到“添加朋友”入口: {add_friend_summary}",
        code="add_friend_entry_found",
        details={"control": add_friend_summary},
    )

    click_error: Exception | None = None
    try:
        click_control(auto, add_friend_entry, prefer_rect_center=True)
        append_log(logs, "info", "已点击“添加朋友”入口", code="add_friend_entry_clicked")
    except Exception as error:
        click_error = error
        append_log(
            logs,
            "warn",
            f"点击“添加朋友”入口后 UIA 返回异常，继续检测窗口是否已打开: {error}",
            code="add_friend_entry_click_unverified",
        )

    add_friend_window = wait_for_match(lambda: find_add_friend_window(auto), timeout=2.0, interval=0.12)
    window_opened = add_friend_window is not None
    if window_opened:
        append_log(
            logs,
            "info",
            f"已检测到“添加朋友”窗口: {describe_control(add_friend_window)}",
            code="add_friend_window_found",
        )
    else:
        if click_error is not None:
            raise RuntimeError(f"点击“添加朋友”入口失败，且未检测到“添加朋友”窗口: {click_error}")
        append_log(logs, "warn", "已点击“添加朋友”，但未检测到“添加朋友”窗口", code="add_friend_window_not_found")

    return logs, {
        "windowName": window_name,
        "menuRegion": menu_region,
        "quickAction": quick_action_data,
        "addFriendEntry": serialize_probe_node(add_friend_entry, 0, "window"),
        "addFriendWindowOpened": window_opened,
    }

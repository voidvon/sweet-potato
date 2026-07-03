from __future__ import annotations

import time
from typing import Any

from ..models import AutomationLog
from ..selectors import find_add_friend_search_box, find_add_friend_window
from ..uia import activate_window, append_log, close_window_gracefully, describe_control, find_window, replace_text, wait_for_match
from .friend_result import handle_add_friend_search_result


def _find_active_add_friend_window(auto: Any) -> Any:
    add_friend_window = wait_for_match(lambda: find_add_friend_window(auto), timeout=2.0, interval=0.15)
    if add_friend_window is None:
        raise RuntimeError("未找到“添加朋友”窗口，请先点击“添加朋友”入口")
    return add_friend_window


def focus_add_friend_search_box(auto: Any) -> tuple[list[AutomationLog], dict[str, Any]]:
    logs: list[AutomationLog] = []
    add_friend_window = _find_active_add_friend_window(auto)
    activate_window(add_friend_window)
    append_log(logs, "info", "已激活“添加朋友”窗口", code="add_friend_window_activated")

    search_box = find_add_friend_search_box(add_friend_window)
    if search_box is None:
        raise RuntimeError("未找到“添加朋友”窗口中的搜索框")

    search_box.Click(simulateMove=False)
    search_box_summary = describe_control(search_box)
    append_log(
        logs,
        "info",
        f"已聚焦“添加朋友”搜索框: {search_box_summary}",
        code="add_friend_search_box_focused",
        details={"control": search_box_summary},
    )
    return logs, {
        "focused": True,
        "searchBox": search_box_summary,
    }


def search_add_friend_account(auto: Any, account: str) -> tuple[list[AutomationLog], dict[str, Any]]:
    logs: list[AutomationLog] = []
    add_friend_window = _find_active_add_friend_window(auto)
    activate_window(add_friend_window)
    append_log(logs, "info", "已激活“添加朋友”窗口", code="add_friend_window_activated")

    search_box = find_add_friend_search_box(add_friend_window)
    if search_box is None:
        raise RuntimeError("未找到“添加朋友”窗口中的搜索框")

    replace_text(auto, search_box, account)
    append_log(
        logs,
        "info",
        f"已输入微信号/手机号: {account}",
        code="account_input_filled",
        details={"account": account},
    )
    auto.SendKeys("{Enter}")
    time.sleep(0.45)
    append_log(logs, "info", "已提交账号搜索", code="account_search_submitted")
    return logs, {
        "searched": True,
        "account": account,
    }


def handle_current_add_friend_result(
    auto: Any,
    window_name: str,
    greeting: str,
) -> tuple[list[AutomationLog], dict[str, Any]]:
    logs: list[AutomationLog] = []
    add_friend_window = _find_active_add_friend_window(auto)
    handle_add_friend_search_result(
        auto,
        None,
        add_friend_window,
        greeting,
        logs,
        main_window_resolver=lambda: find_window(auto, window_name),
    )
    return logs, {
        "handled": True,
        "windowName": window_name,
    }


def close_current_add_friend_windows(auto: Any) -> tuple[list[AutomationLog], dict[str, Any]]:
    logs: list[AutomationLog] = []
    closed_count = 0

    while True:
        add_friend_window = wait_for_match(lambda: find_add_friend_window(auto), timeout=0.5, interval=0.1)
        if add_friend_window is None:
            break
        if not close_window_gracefully(add_friend_window):
            append_log(logs, "warn", "未能自动关闭“添加朋友”窗口", code="add_friend_window_close_failed")
            break
        closed_count += 1
        append_log(logs, "info", "已关闭“添加朋友”窗口", code="add_friend_window_closed")
        time.sleep(0.15)

    if closed_count == 0:
        append_log(logs, "info", "未发现需要关闭的“添加朋友”窗口", code="add_friend_window_not_found")

    return logs, {
        "closedCount": closed_count,
    }

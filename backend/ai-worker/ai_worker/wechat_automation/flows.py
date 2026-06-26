from __future__ import annotations

import time
from typing import Any

from .models import AutomationLog
from .constants import PANEL_CHAT_NAME
from .selectors import (
    collect_add_friend_menu_probe,
    find_add_friend_entry,
    find_add_friend_search_box,
    find_add_friend_window,
    find_plus_button,
)
from .uia import (
    activate_window,
    append_log,
    click_control,
    describe_control,
    find_window,
    get_rect_tuple,
    probe_window,
    replace_text,
    wait_for_match,
)
from .tools.add_friend_entry import click_add_friend_entry as run_click_add_friend_entry_tool
from .tools.add_friend_window import (
    close_current_add_friend_windows as run_close_current_add_friend_windows_tool,
    focus_add_friend_search_box as run_focus_add_friend_search_box_tool,
    handle_current_add_friend_result as run_handle_current_add_friend_result_tool,
    search_add_friend_account as run_search_add_friend_account_tool,
)
from .tools.friend_result import (
    focus_and_fill_chat_message as run_focus_and_fill_chat_message_tool,
    focus_and_send_chat_message as run_focus_and_send_chat_message_tool,
    handle_add_friend_search_result as run_handle_add_friend_search_result_tool,
)
from .tools.panel import ensure_chat_panel as run_ensure_chat_panel_tool
from .tools.panel import identify_current_panel as run_identify_current_panel_tool
from .tools.panel import switch_panel as run_switch_panel_tool
from .tools.quick_action import open_quick_action_menu as run_open_quick_action_menu_tool


def run_probe(auto: Any, window_name: str) -> dict[str, Any]:
    return probe_window(auto, window_name)


def _append_timing_log(logs: list[AutomationLog], message: str, code: str, started_at: float) -> None:
    append_log(
        logs,
        "info",
        message,
        code=code,
        details={"durationMs": round((time.perf_counter() - started_at) * 1000)},
    )


def identify_current_panel(auto: Any, window_name: str) -> tuple[list[AutomationLog], dict[str, Any]]:
    return run_identify_current_panel_tool(auto, window_name)


def switch_panel(auto: Any, window_name: str, panel: str) -> tuple[list[AutomationLog], dict[str, Any]]:
    return run_switch_panel_tool(auto, window_name, panel)


def probe_add_friend_menu(auto: Any, window_name: str) -> tuple[list[AutomationLog], dict[str, Any]]:
    logs: list[AutomationLog] = []
    window = find_window(auto, window_name)
    append_log(logs, "info", f"已找到微信窗口: {window_name}", code="window_found", details={"windowName": window_name})

    activate_window(window)
    append_log(logs, "info", "已激活微信窗口", code="window_activated", details={"windowName": window_name})

    plus_button = find_plus_button(window)
    plus_button_summary = describe_control(plus_button)
    append_log(
        logs,
        "info",
        f"已定位右上角加号按钮: {plus_button_summary}",
        code="quick_action_button_found",
        details={"control": plus_button_summary},
    )

    click_control(auto, plus_button, prefer_rect_center=True)
    time.sleep(0.5)
    append_log(logs, "info", "已点击右上角加号按钮，开始探测弹出菜单", code="quick_action_clicked")

    menu_region, plus_button_node, related_controls = collect_add_friend_menu_probe(auto, window, window_name)
    append_log(
        logs,
        "info",
        f"已限制探测范围为微信窗口内菜单区域: {menu_region}",
        code="menu_region_bounded",
        details={"menuRegion": menu_region},
    )
    append_log(
        logs,
        "info",
        f"已采集到 {len(related_controls)} 个相关控件",
        code="menu_controls_collected",
        details={"relatedControlCount": len(related_controls)},
    )

    return logs, {
        "windowName": window_name,
        "menuRegion": menu_region,
        "plusButton": plus_button_node,
        "relatedControls": related_controls,
    }


def probe_quick_action(auto: Any, window_name: str) -> tuple[list[AutomationLog], dict[str, Any]]:
    logs: list[AutomationLog] = []
    window = find_window(auto, window_name)
    append_log(
        logs,
        "info",
        f"已找到微信窗口: {window_name}",
        code="window_found",
        details={"windowName": window_name},
    )

    data: dict[str, Any] = {
        "windowName": window_name,
        "activated": False,
        "clicked": False,
        "menuOpened": False,
        "quickActionButton": None,
        "candidates": [],
    }

    activate_window(window)
    data["activated"] = True
    append_log(logs, "info", "已激活微信窗口，开始定位“快捷操作”按钮", code="window_activated_for_quick_action_click")

    _click_target, _menu_region, quick_action_data = _open_quick_action_menu(
        auto,
        window,
        window_name,
        logs,
        context_code_prefix="quick_action",
    )
    data.update(quick_action_data)
    data["clicked"] = True

    return logs, data


def click_add_friend_entry(auto: Any, window_name: str) -> tuple[list[AutomationLog], dict[str, Any]]:
    return run_click_add_friend_entry_tool(auto, window_name)


def focus_add_friend_search_box(auto: Any) -> tuple[list[AutomationLog], dict[str, Any]]:
    return run_focus_add_friend_search_box_tool(auto)


def search_add_friend_account(auto: Any, account: str) -> tuple[list[AutomationLog], dict[str, Any]]:
    return run_search_add_friend_account_tool(auto, account)


def handle_current_add_friend_result(auto: Any, window_name: str, greeting: str) -> tuple[list[AutomationLog], dict[str, Any]]:
    return run_handle_current_add_friend_result_tool(auto, window_name, greeting)


def close_current_add_friend_windows(auto: Any) -> tuple[list[AutomationLog], dict[str, Any]]:
    return run_close_current_add_friend_windows_tool(auto)


def focus_and_fill_current_chat_message(auto: Any, window_name: str, message_text: str) -> tuple[list[AutomationLog], dict[str, Any]]:
    logs: list[AutomationLog] = []
    window = find_window(auto, window_name)
    append_log(logs, "info", f"已找到微信窗口: {window_name}", code="window_found", details={"windowName": window_name})

    activate_window(window)
    append_log(logs, "info", "已激活微信窗口", code="window_activated", details={"windowName": window_name})

    started_at = time.perf_counter()
    run_focus_and_fill_chat_message_tool(
        auto,
        window,
        message_text,
        logs,
        focus_code="current_chat_message_input_focused",
        content_code="current_chat_message_content_filled",
        editor_timeout=1.5,
    )
    _append_timing_log(logs, "聚焦并发送当前聊天消息耗时", "timing_focus_and_send_current_chat_message", started_at)
    return logs, {
        "sent": True,
        "windowName": window_name,
        "messageLength": len(message_text),
    }


def _focus_and_send_chat_message(
    auto: Any,
    window: Any,
    message_text: str,
    logs: list[AutomationLog],
    *,
    focus_code: str = "message_input_focused",
    content_code: str = "message_content_filled",
    sent_code: str = "message_sent",
    editor_timeout: float = 5.0,
) -> None:
    run_focus_and_send_chat_message_tool(
        auto,
        window,
        message_text,
        logs,
        focus_code=focus_code,
        content_code=content_code,
        sent_code=sent_code,
        editor_timeout=editor_timeout,
    )


def _ensure_chat_panel(auto: Any, window: Any, window_name: str, logs: list[AutomationLog]) -> dict[str, Any]:
    return run_ensure_chat_panel_tool(auto, window, window_name, logs)


def _open_quick_action_menu(
    auto: Any,
    window: Any,
    window_name: str,
    logs: list[AutomationLog],
    *,
    context_code_prefix: str = "quick_action",
) -> tuple[Any, tuple[int, int, int, int], dict[str, Any]]:
    return run_open_quick_action_menu_tool(
        auto,
        window,
        window_name,
        logs,
        context_code_prefix=context_code_prefix,
    )


def open_add_friend(auto: Any, window_name: str, account: str, greeting: str) -> list[AutomationLog]:
    logs: list[AutomationLog] = []
    started_at = time.perf_counter()
    window = find_window(auto, window_name)
    append_log(logs, "info", f"已找到微信窗口: {window_name}", code="window_found", details={"windowName": window_name})
    _append_timing_log(logs, "查找微信窗口耗时", "timing_find_wechat_window", started_at)

    started_at = time.perf_counter()
    activate_window(window)
    append_log(logs, "info", "已激活微信窗口", code="window_activated", details={"windowName": window_name})
    _append_timing_log(logs, "激活微信窗口耗时", "timing_activate_wechat_window", started_at)

    started_at = time.perf_counter()
    ensure_panel_data = _ensure_chat_panel(auto, window, window_name, logs)
    _append_timing_log(logs, "识别并确保微信面板耗时", "timing_ensure_chat_panel", started_at)
    if ensure_panel_data.get("after", {}).get("panel") != PANEL_CHAT_NAME:
        raise RuntimeError("当前不在微信面板，且自动切换到微信面板失败")

    started_at = time.perf_counter()
    _quick_action_button, menu_region, quick_action_data = run_open_quick_action_menu_tool(
        auto,
        window,
        window_name,
        logs,
        context_code_prefix="open_add_friend_quick_action",
    )
    _append_timing_log(logs, "打开快捷操作菜单耗时", "timing_open_quick_action_menu", started_at)
    if not quick_action_data.get("menuOpened"):
        raise RuntimeError("未能打开快捷操作菜单，无法继续点击“添加朋友”")

    window_rect = get_rect_tuple(window)
    if not window_rect:
        raise RuntimeError("无法读取微信窗口坐标，无法定位添加朋友入口")

    started_at = time.perf_counter()
    add_friend_entry = wait_for_match(
        lambda: find_add_friend_entry(auto, window, window_rect, menu_region),
        timeout=1.2,
        interval=0.08,
    )
    _append_timing_log(logs, "查找“添加朋友”入口耗时", "timing_find_add_friend_entry", started_at)
    if add_friend_entry is None:
        raise RuntimeError("已点击“快捷操作”按钮，但未找到“添加朋友”入口")

    add_friend_entry_summary = describe_control(add_friend_entry)
    append_log(
        logs,
        "info",
        f"已找到“添加朋友”入口: {add_friend_entry_summary}",
        code="add_friend_entry_found",
        details={"control": add_friend_entry_summary},
    )

    started_at = time.perf_counter()
    click_control(auto, add_friend_entry, prefer_rect_center=True)
    append_log(logs, "info", "已点击“添加朋友”入口", code="add_friend_entry_clicked")
    _append_timing_log(logs, "点击“添加朋友”入口耗时", "timing_click_add_friend_entry", started_at)

    started_at = time.perf_counter()
    add_friend_window = wait_for_match(lambda: find_add_friend_window(auto), timeout=2.0, interval=0.12)
    _append_timing_log(logs, "等待“添加朋友”窗口出现耗时", "timing_wait_add_friend_window", started_at)
    if add_friend_window is None:
        raise RuntimeError("点击“添加朋友”后未找到“添加朋友”窗口")

    add_friend_window_summary = describe_control(add_friend_window)
    append_log(
        logs,
        "info",
        f"已找到“添加朋友”窗口: {add_friend_window_summary}",
        code="add_friend_window_found",
        details={"control": add_friend_window_summary},
    )
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

    run_handle_add_friend_search_result_tool(auto, window, add_friend_window, greeting, logs)
    return logs


def send_message(auto: Any, window_name: str, contact_name: str, message_text: str) -> list[AutomationLog]:
    logs: list[AutomationLog] = []
    window = find_window(auto, window_name)
    append_log(logs, "info", f"已找到微信窗口: {window_name}", code="window_found", details={"windowName": window_name})

    activate_window(window)
    append_log(logs, "info", "已激活微信窗口", code="window_activated", details={"windowName": window_name})

    auto.SendKeys("^f")
    time.sleep(0.3)
    append_log(logs, "info", "已打开搜索框", code="search_box_opened")

    auto.SendKeys("^a")
    time.sleep(0.05)
    auto.SendKeys("{Del}")
    time.sleep(0.05)
    auto.SendKeys(contact_name)
    time.sleep(0.3)
    append_log(
        logs,
        "info",
        f"已输入联系人关键词: {contact_name}",
        code="contact_keyword_filled",
        details={"contactName": contact_name},
    )

    auto.SendKeys("{Enter}")
    time.sleep(0.35)
    append_log(logs, "info", "已尝试打开联系人会话", code="contact_conversation_open_attempted")

    _focus_and_send_chat_message(auto, window, message_text, logs, editor_timeout=3.0)
    return logs

from __future__ import annotations

import time
from typing import Any

from .models import AutomationLog
from .selectors import (
    build_menu_probe_region,
    click_add_to_contacts,
    click_send_request,
    collect_add_friend_menu_probe,
    find_add_friend_entry,
    find_add_friend_search_box,
    find_add_friend_window,
    find_plus_button,
    find_request_friend_window,
    find_request_greeting_editor,
    find_request_greeting_editor_from_root,
)
from .uia import (
    activate_window,
    append_log,
    close_window_gracefully,
    describe_control,
    find_window,
    get_rect_tuple,
    probe_window,
    replace_text,
    summarize_controls,
    wait_for_match,
)


def run_probe(auto: Any, window_name: str) -> dict[str, Any]:
    return probe_window(auto, window_name)


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

    plus_button.Click(simulateMove=False)
    time.sleep(0.6)
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


def open_add_friend(auto: Any, window_name: str, account: str, greeting: str) -> list[AutomationLog]:
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

    window_rect = get_rect_tuple(window)
    if not window_rect:
        raise RuntimeError("无法读取微信窗口坐标，无法定位添加朋友入口")

    plus_rect = get_rect_tuple(plus_button)
    menu_region = build_menu_probe_region(window_rect, plus_rect)
    append_log(
        logs,
        "info",
        f"已限制查找范围为微信窗口内菜单区域: {menu_region}",
        code="menu_region_bounded",
        details={"menuRegion": menu_region},
    )

    add_friend_entry = None
    for attempt in range(2):
        plus_button.Click(simulateMove=False)
        time.sleep(0.5)
        append_log(
            logs,
            "info",
            "已点击右上角加号按钮",
            code="quick_action_clicked",
            details={"attempt": attempt + 1},
        )

        add_friend_entry = wait_for_match(
            lambda: find_add_friend_entry(auto, window, window_rect, menu_region),
            timeout=2.5,
            interval=0.2,
        )
        if add_friend_entry is not None:
            break

        if attempt == 0:
            append_log(logs, "warn", "首次未找到“添加朋友”，准备重试点击加号", code="add_friend_entry_retry")
            plus_button = find_plus_button(window)
            plus_rect = get_rect_tuple(plus_button)
            menu_region = build_menu_probe_region(window_rect, plus_rect)

    if add_friend_entry is None:
        add_friend_entry = find_add_friend_entry(auto, window, window_rect, menu_region)

    add_friend_summary = describe_control(add_friend_entry)
    append_log(
        logs,
        "info",
        f"已找到“添加朋友”入口: {add_friend_summary}",
        code="add_friend_entry_found",
        details={"control": add_friend_summary},
    )
    add_friend_entry.Click(simulateMove=False)
    time.sleep(0.5)
    append_log(logs, "info", "已点击“添加朋友”", code="add_friend_entry_clicked")

    add_friend_window = wait_for_match(lambda: find_add_friend_window(auto), timeout=4.0, interval=0.2)
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
    time.sleep(0.8)
    append_log(logs, "info", "已提交账号搜索", code="account_search_submitted")

    add_to_contacts_candidates: list[Any] = []

    def try_click_add_to_contacts() -> Any | None:
        for target_window in (add_friend_window, window):
            control, candidates = click_add_to_contacts(auto, target_window)
            if candidates:
                add_to_contacts_candidates[:] = candidates
            if control is not None:
                return control
        return None

    add_to_contacts = wait_for_match(try_click_add_to_contacts, timeout=6.0, interval=0.3)
    if add_to_contacts is None:
        candidate_summary = summarize_controls(add_to_contacts_candidates)
        if candidate_summary:
            raise RuntimeError(f"未找到“添加到通讯录”入口，候选控件: {candidate_summary}")
        raise RuntimeError("未找到“添加到通讯录”入口")

    add_to_contacts_summary = describe_control(add_to_contacts)
    append_log(
        logs,
        "info",
        f"已点击添加按钮: {add_to_contacts_summary}",
        code="add_to_contacts_clicked",
        details={"control": add_to_contacts_summary},
    )
    time.sleep(0.8)

    request_window = wait_for_match(lambda: find_request_friend_window(auto), timeout=4.0, interval=0.2)
    if request_window is None:
        raise RuntimeError("点击“添加到通讯录”后未找到“申请添加朋友”窗口")

    request_window_summary = describe_control(request_window)
    append_log(
        logs,
        "info",
        f"已找到“申请添加朋友”窗口: {request_window_summary}",
        code="request_window_found",
        details={"control": request_window_summary},
    )
    activate_window(request_window)
    append_log(logs, "info", "已激活“申请添加朋友”窗口", code="request_window_activated")

    greeting_editor = wait_for_match(
        lambda: find_request_greeting_editor(request_window) or find_request_greeting_editor_from_root(auto, request_window),
        timeout=5.0,
        interval=0.2,
    )
    if greeting_editor is None:
        raise RuntimeError("未找到“发送添加朋友申请”下方的多行输入框")

    replace_text(auto, greeting_editor, greeting)
    append_log(
        logs,
        "info",
        f"已输入打招呼内容: {greeting}",
        code="greeting_input_filled",
        details={"greeting": greeting},
    )

    send_button_candidates: list[Any] = []

    def try_click_send_request() -> Any | None:
        control, candidates = click_send_request(auto, request_window)
        if candidates:
            send_button_candidates[:] = candidates
        return control

    send_button = wait_for_match(try_click_send_request, timeout=4.0, interval=0.2)
    if send_button is None:
        auto.SendKeys("{Enter}")
        if send_button_candidates:
            append_log(
                logs,
                "warn",
                f"未找到发送按钮，候选控件: {summarize_controls(send_button_candidates)}；已回退为回车提交",
                code="send_request_fallback_enter",
                details={"candidateCount": len(send_button_candidates)},
            )
        else:
            append_log(logs, "warn", "未找到发送按钮，已回退为回车提交", code="send_request_fallback_enter")
    else:
        send_button_summary = describe_control(send_button)
        append_log(
            logs,
            "info",
            f"已点击发送按钮: {send_button_summary}",
            code="send_request_clicked",
            details={"control": send_button_summary},
        )

    time.sleep(0.8)

    if close_window_gracefully(request_window):
        append_log(logs, "info", "已关闭“申请添加朋友”窗口", code="request_window_closed")
        time.sleep(0.3)
    else:
        append_log(logs, "warn", "未能自动关闭“申请添加朋友”窗口", code="request_window_close_failed")

    add_friend_window_still_open = wait_for_match(lambda: find_add_friend_window(auto), timeout=1.0, interval=0.2)
    if add_friend_window_still_open is not None and close_window_gracefully(add_friend_window_still_open):
        append_log(logs, "info", "已关闭“添加朋友”窗口", code="add_friend_window_closed")
        time.sleep(0.3)

    append_log(logs, "info", "微信添加流程已完成", code="flow_completed")
    return logs


def send_message(auto: Any, window_name: str, contact_name: str, message_text: str) -> list[AutomationLog]:
    logs: list[AutomationLog] = []
    window = find_window(auto, window_name)
    append_log(logs, "info", f"已找到微信窗口: {window_name}", code="window_found", details={"windowName": window_name})

    activate_window(window)
    append_log(logs, "info", "已激活微信窗口", code="window_activated", details={"windowName": window_name})

    auto.SendKeys("^f")
    time.sleep(0.4)
    append_log(logs, "info", "已打开搜索框", code="search_box_opened")

    auto.SendKeys("^a")
    time.sleep(0.1)
    auto.SendKeys("{Del}")
    time.sleep(0.1)
    auto.SendKeys(contact_name)
    time.sleep(0.5)
    append_log(
        logs,
        "info",
        f"已输入联系人关键词: {contact_name}",
        code="contact_keyword_filled",
        details={"contactName": contact_name},
    )

    auto.SendKeys("{Enter}")
    time.sleep(0.6)
    append_log(logs, "info", "已尝试打开联系人会话", code="contact_conversation_open_attempted")

    edit = window.EditControl(foundIndex=1)
    if not edit.Exists(3):
        raise RuntimeError("未找到消息输入框，请先用探测功能确认微信 UIA 结构")

    edit.Click()
    time.sleep(0.2)
    append_log(logs, "info", "已聚焦消息输入框", code="message_input_focused")

    auto.SendKeys("^a")
    time.sleep(0.1)
    edit.SendKeys(message_text)
    time.sleep(0.2)
    append_log(logs, "info", "已写入消息内容", code="message_content_filled", details={"messageLength": len(message_text)})

    auto.SendKeys("{Enter}")
    append_log(logs, "info", "已触发发送", code="message_sent")
    return logs

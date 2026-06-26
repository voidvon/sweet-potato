from __future__ import annotations

import time
from typing import Any

from ..constants import ADD_TO_CONTACTS_NAME, SEND_MESSAGE_NAME
from ..models import AutomationLog
from ..selectors import (
    click_add_to_contacts_strict,
    click_send_request,
    find_add_friend_window,
    find_add_friend_result_actions,
    find_chat_message_editor,
    find_chat_message_editor_from_root,
    find_request_friend_window,
    find_request_greeting_editor,
    find_request_greeting_editor_from_root,
    find_send_message_button_strict,
)
from ..uia import (
    activate_window,
    append_log,
    click_control,
    close_window_gracefully,
    describe_control,
    get_rect_tuple,
    replace_text,
    summarize_controls,
    wait_for_match,
)


def append_timing_log(logs: list[AutomationLog], message: str, code: str, started_at: float) -> None:
    append_log(
        logs,
        "info",
        message,
        code=code,
        details={"durationMs": round((time.perf_counter() - started_at) * 1000)},
    )


def focus_and_send_chat_message(
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
    editor = wait_for_match(
        lambda: find_chat_message_editor(window) or find_chat_message_editor_from_root(auto, window),
        timeout=editor_timeout,
        interval=0.15,
    )
    if editor is None:
        fallback = window.EditControl(foundIndex=1)
        if fallback.Exists(0.4):
            editor = fallback

    if editor is None:
        raise RuntimeError("未找到消息输入框，请先用探测功能确认微信会话区的 UIA 结构")

    editor.Click(simulateMove=False)
    time.sleep(0.1)
    append_log(logs, "info", "已聚焦消息输入框", code=focus_code)

    replace_text(auto, editor, message_text)
    time.sleep(0.1)
    append_log(
        logs,
        "info",
        "已写入消息内容",
        code=content_code,
        details={"messageLength": len(message_text)},
    )

    auto.SendKeys("{Enter}")
    append_log(logs, "info", "已触发发送", code=sent_code)


def focus_and_fill_chat_message(
    auto: Any,
    window: Any,
    message_text: str,
    logs: list[AutomationLog],
    *,
    focus_code: str = "message_input_focused",
    content_code: str = "message_content_filled",
    editor_timeout: float = 2.0,
) -> None:
    editor = wait_for_match(
        lambda: find_chat_message_editor(window) or find_chat_message_editor_from_root(auto, window),
        timeout=editor_timeout,
        interval=0.15,
    )
    if editor is None:
        fallback = window.EditControl(foundIndex=1)
        if fallback.Exists(0.2):
            editor = fallback

    if editor is None:
        raise RuntimeError("未找到消息输入框，请先确认当前微信主窗口已打开聊天会话")

    editor_summary = describe_control(editor)
    editor.Click(simulateMove=False)
    time.sleep(0.1)
    append_log(
        logs,
        "info",
        f"已聚焦消息输入框: {editor_summary}",
        code=focus_code,
        details={"control": editor_summary, "rect": get_rect_tuple(editor)},
    )

    auto.SendKeys(message_text)
    time.sleep(0.1)
    append_log(
        logs,
        "info",
        "已通过当前焦点写入消息内容",
        code=content_code,
        details={"messageLength": len(message_text)},
    )
    auto.SendKeys("{Enter}")
    append_log(logs, "info", "已触发发送", code="current_chat_message_sent")


def close_add_friend_windows(
    auto: Any,
    logs: list[AutomationLog],
    *,
    request_timeout: float = 0.8,
    add_friend_timeout: float = 0.8,
) -> None:
    request_window = wait_for_match(lambda: find_request_friend_window(auto), timeout=request_timeout, interval=0.15)
    if request_window is not None:
        if close_window_gracefully(request_window):
            append_log(logs, "info", "已关闭“申请添加朋友”窗口", code="request_window_closed")
            time.sleep(0.2)
        else:
            append_log(logs, "warn", "未能自动关闭“申请添加朋友”窗口", code="request_window_close_failed")

    add_friend_window = wait_for_match(lambda: find_add_friend_window(auto), timeout=add_friend_timeout, interval=0.15)
    if add_friend_window is not None:
        if close_window_gracefully(add_friend_window):
            append_log(logs, "info", "已关闭“添加朋友”窗口", code="add_friend_window_closed")
            time.sleep(0.2)
        else:
            append_log(logs, "warn", "未能自动关闭“添加朋友”窗口", code="add_friend_window_close_failed")


def complete_add_request_flow(auto: Any, request_window: Any, greeting: str, logs: list[AutomationLog]) -> None:
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
        timeout=4.0,
        interval=0.15,
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

    send_button = wait_for_match(try_click_send_request, timeout=3.0, interval=0.15)
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
        return

    send_button_summary = describe_control(send_button)
    append_log(
        logs,
        "info",
        f"已点击发送按钮: {send_button_summary}",
        code="send_request_clicked",
        details={"control": send_button_summary},
    )


def handle_add_friend_search_result(
    auto: Any,
    main_window: Any | None,
    add_friend_window: Any,
    greeting: str,
    logs: list[AutomationLog],
    *,
    main_window_resolver: Any | None = None,
) -> None:
    add_to_contacts_candidates: list[Any] = []
    message_button_candidates: list[Any] = []

    def try_click_add_to_contacts() -> Any | None:
        control, candidates = click_add_to_contacts_strict(auto, add_friend_window)
        if candidates:
            add_to_contacts_candidates[:] = candidates
        return control

    def try_find_send_message() -> Any | None:
        control, candidates = find_send_message_button_strict(add_friend_window)
        if candidates:
            message_button_candidates[:] = candidates
        return control

    def try_find_result_action() -> tuple[str, Any] | None:
        actions = find_add_friend_result_actions(add_friend_window)
        candidates = actions.get("candidates")
        if candidates:
            message_button_candidates[:] = [
                control for control in candidates if getattr(control, "Name", "") == SEND_MESSAGE_NAME
            ]
            add_to_contacts_candidates[:] = [
                control for control in candidates if getattr(control, "Name", "") == ADD_TO_CONTACTS_NAME
            ]

        if actions.get("send_message") is not None:
            return "send_message", actions["send_message"]
        if actions.get("add_to_contacts") is not None:
            control = actions["add_to_contacts"]
            control.Click(simulateMove=False)
            return "add_to_contacts", control

        add_to_contacts_control = try_click_add_to_contacts()
        if add_to_contacts_control is not None:
            return "add_to_contacts", add_to_contacts_control

        send_message_control = try_find_send_message()
        if send_message_control is not None:
            return "send_message", send_message_control

        return None

    started_at = time.perf_counter()
    result_action = wait_for_match(try_find_result_action, timeout=3.0, interval=0.2)
    append_timing_log(logs, "查找搜索结果动作耗时", "timing_find_search_result_action", started_at)
    add_to_contacts = result_action[1] if result_action is not None and result_action[0] == "add_to_contacts" else None
    if add_to_contacts is not None:
        add_to_contacts_summary = describe_control(add_to_contacts)
        append_log(
            logs,
            "info",
            f"已点击添加按钮: {add_to_contacts_summary}",
            code="add_to_contacts_clicked",
            details={"control": add_to_contacts_summary},
        )
        time.sleep(0.35)

        started_at = time.perf_counter()
        request_window = wait_for_match(lambda: find_request_friend_window(auto), timeout=2.5, interval=0.15)
        append_timing_log(logs, "等待“申请添加朋友”窗口耗时", "timing_wait_request_friend_window", started_at)
        if request_window is not None:
            started_at = time.perf_counter()
            complete_add_request_flow(auto, request_window, greeting, logs)
            append_timing_log(logs, "填写并发送好友申请耗时", "timing_complete_add_request_flow", started_at)
            time.sleep(0.25)
            started_at = time.perf_counter()
            close_add_friend_windows(auto, logs)
            append_timing_log(logs, "关闭添加朋友相关窗口耗时", "timing_close_add_friend_windows", started_at)
            append_log(logs, "info", "微信添加流程已完成", code="flow_completed")
            return

        append_log(
            logs,
            "warn",
            "点击候选“添加到通讯录”控件后未出现“申请添加朋友”窗口，继续检查是否已是好友",
            code="add_to_contacts_unverified",
            details={"control": add_to_contacts_summary},
        )

    send_message_button = result_action[1] if result_action is not None and result_action[0] == "send_message" else None
    if send_message_button is None:
        started_at = time.perf_counter()
        send_message_button = wait_for_match(try_find_send_message, timeout=1.0, interval=0.2)
        append_timing_log(logs, "补充查找“发消息”按钮耗时", "timing_find_send_message_fallback", started_at)
    if send_message_button is None:
        add_summary = summarize_controls(add_to_contacts_candidates)
        message_summary = summarize_controls(message_button_candidates)
        if add_summary or message_summary:
            raise RuntimeError(
                "搜索结果中既未找到“添加到通讯录”，也未找到“发消息”按钮；"
                f"添加候选: {add_summary or '无'}；发消息候选: {message_summary or '无'}"
            )
        raise RuntimeError("搜索结果中既未找到“添加到通讯录”，也未找到“发消息”按钮")

    send_message_button_summary = describe_control(send_message_button)
    started_at = time.perf_counter()
    click_control(auto, send_message_button, prefer_rect_center=True)
    append_timing_log(logs, "点击“发消息”按钮耗时", "timing_click_send_message_button", started_at)
    append_log(
        logs,
        "info",
        f"检测到该账号已是好友，已点击“发消息”: {send_message_button_summary}",
        code="existing_friend_message_button_clicked",
        details={"control": send_message_button_summary},
    )
    time.sleep(0.25)

    started_at = time.perf_counter()
    remaining_add_friend_window = wait_for_match(lambda: find_add_friend_window(auto), timeout=0.6, interval=0.15)
    if remaining_add_friend_window is not None:
        if close_window_gracefully(remaining_add_friend_window):
            append_log(logs, "info", "已关闭残留的“添加朋友”窗口", code="add_friend_window_closed_after_message")
            time.sleep(0.2)
        else:
            append_log(logs, "warn", "未能自动关闭残留的“添加朋友”窗口", code="add_friend_window_close_after_message_failed")
    append_timing_log(logs, "检测并关闭残留添加朋友窗口耗时", "timing_close_remaining_add_friend_window", started_at)

    if main_window is None:
        if main_window_resolver is None:
            raise RuntimeError("未提供主微信窗口，无法进入聊天会话发送消息")
        started_at = time.perf_counter()
        main_window = main_window_resolver()
        append_timing_log(logs, "查找主微信窗口耗时", "timing_find_main_window_for_message", started_at)

    started_at = time.perf_counter()
    activate_window(main_window)
    append_timing_log(logs, "激活主微信窗口耗时", "timing_activate_main_window_for_message", started_at)
    append_log(logs, "info", "已切回主微信窗口准备发送消息", code="main_window_reactivated_for_message")

    started_at = time.perf_counter()
    focus_and_send_chat_message(
        auto,
        main_window,
        greeting,
        logs,
        focus_code="existing_friend_message_input_focused",
        content_code="existing_friend_message_content_filled",
        sent_code="existing_friend_message_sent",
        editor_timeout=1.2,
    )
    append_timing_log(logs, "聚焦并发送聊天消息耗时", "timing_focus_and_send_existing_friend_message", started_at)

    time.sleep(0.25)
    started_at = time.perf_counter()
    close_add_friend_windows(auto, logs, request_timeout=0.1, add_friend_timeout=0.1)
    append_timing_log(logs, "最终关闭添加朋友相关窗口耗时", "timing_final_close_add_friend_windows", started_at)
    append_log(logs, "info", "微信添加流程已完成", code="flow_completed")

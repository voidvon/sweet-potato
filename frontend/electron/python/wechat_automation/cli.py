from __future__ import annotations

import argparse
import json
import sys
from typing import Any

from .constants import DEFAULT_WINDOW_NAME
from .flows import (
    click_add_friend_entry,
    close_current_add_friend_windows,
    detect_unread_and_open,
    focus_and_fill_current_chat_message,
    focus_add_friend_search_box,
    handle_current_add_friend_result,
    identify_current_panel,
    open_add_friend,
    probe_add_friend_menu,
    probe_quick_action,
    run_probe,
    search_and_open_friend,
    search_add_friend_account,
    send_message,
    switch_panel,
)
from .selectors import find_add_friend_window
from .uia import describe_control, load_auto


def emit(payload: dict[str, Any]) -> int:
    data = json.dumps(payload, ensure_ascii=False)
    sys.stdout.buffer.write(data.encode("utf-8"))
    sys.stdout.buffer.write(b"\n")
    sys.stdout.flush()
    return 0


def is_benign_uia_event_error(error: Exception) -> bool:
    message = str(error)
    return "-2147220991" in message or "事件无法调用任何订户" in message


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="WeChat automation with uiautomation")
    subparsers = parser.add_subparsers(dest="command", required=True)

    probe_parser = subparsers.add_parser("probe", help="Probe top-level child controls")
    probe_parser.add_argument("--window-name", default=DEFAULT_WINDOW_NAME, help="Target window title")

    identify_panel_parser = subparsers.add_parser("identify-current-panel", help="Identify current WeChat sidebar panel")
    identify_panel_parser.add_argument("--window-name", default=DEFAULT_WINDOW_NAME, help="Target window title")

    switch_panel_parser = subparsers.add_parser("switch-panel", help="Switch WeChat sidebar panel")
    switch_panel_parser.add_argument("--window-name", default=DEFAULT_WINDOW_NAME, help="Target window title")
    switch_panel_parser.add_argument("--panel", required=True, choices=("微信", "通讯录"), help="Target panel")

    add_friend_parser = subparsers.add_parser("open-add-friend", help="Open add-friend flow")
    add_friend_parser.add_argument("--window-name", default=DEFAULT_WINDOW_NAME, help="Target window title")
    add_friend_parser.add_argument("--account", required=True, help="Wechat id or phone number")
    add_friend_parser.add_argument("--greeting", required=True, help="Greeting content")

    probe_add_friend_parser = subparsers.add_parser("probe-add-friend-menu", help="Probe quick action menu")
    probe_add_friend_parser.add_argument("--window-name", default=DEFAULT_WINDOW_NAME, help="Target window title")

    probe_quick_action_parser = subparsers.add_parser("probe-quick-action", help="Probe quick action button without activating WeChat")
    probe_quick_action_parser.add_argument("--window-name", default=DEFAULT_WINDOW_NAME, help="Target window title")

    click_add_friend_entry_parser = subparsers.add_parser("click-add-friend-entry", help="Click add friend entry from quick action menu")
    click_add_friend_entry_parser.add_argument("--window-name", default=DEFAULT_WINDOW_NAME, help="Target window title")

    subparsers.add_parser("focus-add-friend-search", help="Focus add-friend search box")

    search_add_friend_parser = subparsers.add_parser("search-add-friend-account", help="Input account in add-friend window and submit search")
    search_add_friend_parser.add_argument("--account", required=True, help="Wechat id or phone number")

    handle_add_friend_result_parser = subparsers.add_parser("handle-add-friend-result", help="Handle current add-friend search result")
    handle_add_friend_result_parser.add_argument("--window-name", default=DEFAULT_WINDOW_NAME, help="Target window title")
    handle_add_friend_result_parser.add_argument("--greeting", required=True, help="Greeting content")

    subparsers.add_parser("close-add-friend-windows", help="Close current add-friend windows")

    focus_fill_chat_parser = subparsers.add_parser("focus-fill-chat-message", help="Focus current chat editor and send message")
    focus_fill_chat_parser.add_argument("--window-name", default=DEFAULT_WINDOW_NAME, help="Target window title")
    focus_fill_chat_parser.add_argument("--message", required=True, help="Message text to fill")

    search_open_friend_parser = subparsers.add_parser("search-open-friend", help="Search friend in WeChat panel and open conversation")
    search_open_friend_parser.add_argument("--window-name", default=DEFAULT_WINDOW_NAME, help="Target window title")
    search_open_friend_parser.add_argument("--contact-name", required=True, help="Target contact name or keyword")

    detect_unread_parser = subparsers.add_parser("detect-unread-and-open", help="Detect unread conversation from the top of chat list and open it")
    detect_unread_parser.add_argument("--window-name", default=DEFAULT_WINDOW_NAME, help="Target window title")

    send_parser = subparsers.add_parser("send-message", help="Search contact and send a message")
    send_parser.add_argument("--window-name", default=DEFAULT_WINDOW_NAME, help="Target window title")
    send_parser.add_argument("--contact-name", required=True, help="Target contact name")
    send_parser.add_argument("--message", required=True, help="Message text to send")
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    try:
        auto = load_auto()
        if args.command == "probe":
            return emit({
                "ok": True,
                "data": run_probe(auto, args.window_name),
            })
        if args.command == "identify-current-panel":
            logs, data = identify_current_panel(auto, args.window_name)
            panel = data.get("panel")
            return emit({
                "ok": panel is not None,
                "message": f"已识别当前微信面板: {panel}" if panel else "未能识别当前微信面板",
                "logs": logs,
                "data": data,
            })
        if args.command == "switch-panel":
            logs, data = switch_panel(auto, args.window_name, args.panel)
            switched = bool(data.get("switched"))
            return emit({
                "ok": switched,
                "message": f"已切换到{args.panel}面板" if switched else f"未能确认已切换到{args.panel}面板",
                "logs": logs,
                "data": data,
            })
        if args.command == "open-add-friend":
            logs = open_add_friend(auto, args.window_name, args.account, args.greeting)
            return emit({
                "ok": True,
                "message": "已执行微信添加流程",
                "logs": logs,
            })
        if args.command == "probe-add-friend-menu":
            logs, data = probe_add_friend_menu(auto, args.window_name)
            return emit({
                "ok": True,
                "message": "已采集加号菜单控件信息",
                "logs": logs,
                "data": data,
            })
        if args.command == "probe-quick-action":
            logs, data = probe_quick_action(auto, args.window_name)
            clicked = bool(data.get("clicked"))
            menu_opened = bool(data.get("menuOpened"))
            return emit({
                "ok": clicked and menu_opened,
                "message": (
                    "已点击快捷操作按钮并检测到菜单展开"
                    if clicked and menu_opened
                    else "快捷操作按钮点击后未检测到菜单展开"
                    if clicked
                    else "后台未找到快捷操作按钮"
                ),
                "logs": logs,
                "data": data,
            })
        if args.command == "click-add-friend-entry":
            try:
                logs, data = click_add_friend_entry(auto, args.window_name)
            except Exception as error:
                if not is_benign_uia_event_error(error):
                    raise

                add_friend_window = find_add_friend_window(auto)
                if add_friend_window is None:
                    raise

                window_summary = describe_control(add_friend_window)
                logs = [{
                    "level": "warn",
                    "code": "uia_event_error_ignored_after_success",
                    "message": f"UIA 返回事件异常，但已检测到“添加朋友”窗口，按成功处理: {error}",
                    "details": {"control": window_summary},
                }]
                data = {
                    "windowName": args.window_name,
                    "addFriendWindowOpened": True,
                    "recoveredFromUiaEventError": True,
                    "addFriendWindow": window_summary,
                }
            window_opened = bool(data.get("addFriendWindowOpened"))
            return emit({
                "ok": window_opened,
                "message": "已点击添加朋友入口并检测到添加朋友窗口" if window_opened else "已点击添加朋友入口，但未检测到添加朋友窗口",
                "logs": logs,
                "data": data,
            })
        if args.command == "focus-add-friend-search":
            logs, data = focus_add_friend_search_box(auto)
            return emit({
                "ok": True,
                "message": "已聚焦添加朋友搜索框",
                "logs": logs,
                "data": data,
            })
        if args.command == "search-add-friend-account":
            logs, data = search_add_friend_account(auto, args.account)
            return emit({
                "ok": True,
                "message": "已提交添加朋友账号搜索",
                "logs": logs,
                "data": data,
            })
        if args.command == "handle-add-friend-result":
            logs, data = handle_current_add_friend_result(auto, args.window_name, args.greeting)
            return emit({
                "ok": True,
                "message": "已处理添加朋友搜索结果",
                "logs": logs,
                "data": data,
            })
        if args.command == "close-add-friend-windows":
            logs, data = close_current_add_friend_windows(auto)
            return emit({
                "ok": True,
                "message": "已执行关闭添加朋友窗口",
                "logs": logs,
                "data": data,
            })
        if args.command == "focus-fill-chat-message":
            logs, data = focus_and_fill_current_chat_message(auto, args.window_name, args.message)
            return emit({
                "ok": True,
                "message": "已发送当前聊天消息",
                "logs": logs,
                "data": data,
            })
        if args.command == "search-open-friend":
            logs = search_and_open_friend(auto, args.window_name, args.contact_name)
            return emit({
                "ok": True,
                "message": "已搜索并尝试打开好友会话",
                "logs": logs,
            })
        if args.command == "detect-unread-and-open":
            logs, data = detect_unread_and_open(auto, args.window_name)
            has_unread = bool(data.get("hasUnread"))
            opened = bool(data.get("opened"))
            return emit({
                "ok": has_unread,
                "message": (
                    "已探测到未读会话并打开"
                    if opened
                    else "已探测到未读会话，但未确认打开"
                    if has_unread
                    else "顶部第一条会话未命中未读格式"
                ),
                "logs": logs,
                "data": data,
            })
        if args.command == "send-message":
            logs = send_message(auto, args.window_name, args.contact_name, args.message)
            return emit({
                "ok": True,
                "message": "消息发送流程已执行",
                "logs": logs,
            })
        return emit({
            "ok": False,
            "message": f"不支持的命令: {args.command}",
        })
    except Exception as error:  # pragma: no cover - environment dependent
        return emit({
            "ok": False,
            "message": f"执行 UIA 操作失败: {error}",
        })

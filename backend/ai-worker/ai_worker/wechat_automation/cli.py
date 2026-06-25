from __future__ import annotations

import argparse
import json
import sys
from typing import Any

from .constants import DEFAULT_WINDOW_NAME
from .flows import open_add_friend, probe_add_friend_menu, run_probe, send_message
from .uia import load_auto


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

    add_friend_parser = subparsers.add_parser("open-add-friend", help="Open add-friend flow")
    add_friend_parser.add_argument("--window-name", default=DEFAULT_WINDOW_NAME, help="Target window title")
    add_friend_parser.add_argument("--account", required=True, help="Wechat id or phone number")
    add_friend_parser.add_argument("--greeting", required=True, help="Greeting content")

    probe_add_friend_parser = subparsers.add_parser("probe-add-friend-menu", help="Probe quick action menu")
    probe_add_friend_parser.add_argument("--window-name", default=DEFAULT_WINDOW_NAME, help="Target window title")

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

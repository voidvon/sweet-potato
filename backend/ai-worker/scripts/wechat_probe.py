#!/usr/bin/env python3
"""WeChat UI Automation helper."""

from __future__ import annotations

import argparse
import json
import sys
import time
from typing import Any

DEFAULT_WINDOW_NAME = "\u5fae\u4fe1"


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


if __name__ == "__main__":
    raise SystemExit(main())

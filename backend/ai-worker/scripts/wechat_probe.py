#!/usr/bin/env python3
"""WeChat UI Automation helper."""

from __future__ import annotations

import argparse
import json
import time
from typing import Any


def emit(payload: dict[str, Any]) -> int:
    print(json.dumps(payload, ensure_ascii=False))
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="WeChat automation with uiautomation")
    subparsers = parser.add_subparsers(dest="command", required=True)

    probe_parser = subparsers.add_parser("probe", help="Probe top-level child controls")
    probe_parser.add_argument("--window-name", default="微信", help="Target window title")

    send_parser = subparsers.add_parser("send-message", help="Search contact and send a message")
    send_parser.add_argument("--window-name", default="微信", help="Target window title")
    send_parser.add_argument("--contact-name", required=True, help="Target contact name")
    send_parser.add_argument("--message", required=True, help="Message text to send")

    return parser


def load_auto():
    try:
        import uiautomation as auto
    except Exception as error:  # pragma: no cover - environment dependent
        raise RuntimeError(f"导入 uiautomation 失败: {error}") from error
    return auto


def find_window(auto: Any, window_name: str):
    window = auto.WindowControl(searchDepth=1, Name=window_name)
    if not window.Exists(3):
        raise RuntimeError(f"未找到窗口: {window_name}")
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
    append_log(logs, "info", f"已找到微信窗口: {window_name}")

    window.SetActive()
    time.sleep(0.3)
    append_log(logs, "info", "已激活微信窗口")

    auto.SendKeys("^f")
    time.sleep(0.4)
    append_log(logs, "info", "已打开搜索框")

    auto.SendKeys("^a")
    time.sleep(0.1)
    auto.SendKeys("{Del}")
    time.sleep(0.1)
    auto.SendKeys(contact_name)
    time.sleep(0.5)
    append_log(logs, "info", f"已输入联系人关键词: {contact_name}")

    auto.SendKeys("{Enter}")
    time.sleep(0.6)
    append_log(logs, "info", "已尝试打开联系人会话")

    edit = window.EditControl(foundIndex=1)
    if not edit.Exists(3):
        raise RuntimeError("未找到消息输入框，请先用探测功能确认微信 UIA 结构")

    edit.Click()
    time.sleep(0.2)
    append_log(logs, "info", "已聚焦消息输入框")

    auto.SendKeys("^a")
    time.sleep(0.1)
    edit.SendKeys(message_text)
    time.sleep(0.2)
    append_log(logs, "info", "已写入消息内容")

    auto.SendKeys("{Enter}")
    append_log(logs, "info", "已触发发送")
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


if __name__ == "__main__":
    raise SystemExit(main())

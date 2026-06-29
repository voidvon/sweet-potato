from __future__ import annotations

from typing import Any

from ..constants import PANEL_CHAT_NAME, PANEL_CONTACTS_NAME
from ..models import AutomationLog
from ..selectors import find_sidebar_panel_button, identify_current_panel as identify_current_panel_state
from ..uia import activate_window, append_log, click_control, describe_control, find_window, wait_for_match


def identify_current_panel(auto: Any, window_name: str) -> tuple[list[AutomationLog], dict[str, Any]]:
    logs: list[AutomationLog] = []
    window = find_window(auto, window_name)
    append_log(
        logs,
        "info",
        f"已找到微信窗口: {window_name}",
        code="window_found",
        details={"windowName": window_name, "activated": False},
    )

    data = identify_current_panel_state(window)
    panel = data.get("panel")
    confidence = data.get("confidence", 0)
    if panel:
        append_log(
            logs,
            "info",
            f"已识别当前微信面板: {panel}",
            code="wechat_panel_identified",
            details={"panel": panel, "confidence": confidence, "method": data.get("method")},
        )
    else:
        append_log(
            logs,
            "warn",
            "未能识别当前微信面板",
            code="wechat_panel_unknown",
            details={"method": data.get("method"), "signals": data.get("signals")},
        )
    return logs, {
        "windowName": window_name,
        "activated": False,
        **data,
    }


def switch_panel(auto: Any, window_name: str, panel: str) -> tuple[list[AutomationLog], dict[str, Any]]:
    logs: list[AutomationLog] = []
    if panel not in {PANEL_CHAT_NAME, PANEL_CONTACTS_NAME}:
        raise RuntimeError(f"不支持切换到面板: {panel}")

    window = find_window(auto, window_name)
    append_log(logs, "info", f"已找到微信窗口: {window_name}", code="window_found", details={"windowName": window_name})

    activate_window(window)
    append_log(logs, "info", f"已激活微信窗口，准备切换到“{panel}”面板", code="window_activated")

    control, match_info = find_sidebar_panel_button(window, panel)
    if control is None:
        raise RuntimeError(f"未找到“{panel}”面板入口")

    control_summary = describe_control(control)
    append_log(
        logs,
        "info",
        f"已定位“{panel}”面板入口: {control_summary}",
        code="panel_entry_found",
        details={"targetPanel": panel, "matchInfo": match_info},
    )

    click_control(auto, control, prefer_rect_center=True)
    append_log(logs, "info", f"已点击“{panel}”面板入口", code="panel_entry_clicked", details={"targetPanel": panel})

    def wait_for_target_panel() -> dict[str, Any] | None:
        state = identify_current_panel_state(window)
        return state if state.get("panel") == panel else None

    panel_state = wait_for_match(wait_for_target_panel, timeout=1.8, interval=0.15)
    if panel_state is None:
        panel_state = identify_current_panel_state(window)
        append_log(
            logs,
            "warn",
            f"已点击“{panel}”面板入口，但当前识别结果不是目标面板",
            code="panel_switch_not_confirmed",
            details={"targetPanel": panel, "currentPanel": panel_state.get("panel"), "method": panel_state.get("method")},
        )
    else:
        append_log(
            logs,
            "info",
            f"已确认切换到“{panel}”面板",
            code="panel_switch_confirmed",
            details={"targetPanel": panel, "method": panel_state.get("method")},
        )

    return logs, {
        "windowName": window_name,
        "targetPanel": panel,
        "matchInfo": match_info,
        "currentPanel": panel_state,
        "switched": panel_state.get("panel") == panel,
    }


def ensure_chat_panel(auto: Any, window: Any, window_name: str, logs: list[AutomationLog]) -> dict[str, Any]:
    panel_state = identify_current_panel_state(window)
    append_log(
        logs,
        "info",
        "已识别当前微信面板",
        code="current_panel_identified_before_add_friend",
        details={"panel": panel_state.get("panel"), "method": panel_state.get("method"), "signals": panel_state.get("signals")},
    )
    if panel_state.get("panel") == PANEL_CHAT_NAME:
        return {"before": panel_state, "switched": False, "after": panel_state}

    switch_logs, switch_data = switch_panel(auto, window_name, PANEL_CHAT_NAME)
    logs.extend(switch_logs)
    return {
        "before": panel_state,
        "switched": bool(switch_data.get("switched")),
        "after": switch_data.get("currentPanel"),
        "switchData": switch_data,
    }

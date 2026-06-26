from __future__ import annotations

import time
from typing import Any

from ..models import AutomationLog
from ..selectors import (
    build_menu_probe_region,
    collect_add_friend_menu_probe,
    find_add_friend_entry,
    find_plus_button,
    find_quick_action_list,
)
from ..uia import (
    append_log,
    click_control,
    describe_control,
    get_rect_tuple,
    physical_click_rect_center,
    serialize_probe_node,
    wait_for_match,
)


def wait_for_quick_action_menu(
    window: Any,
    auto: Any,
    window_rect: tuple[int, int, int, int],
    menu_region: tuple[int, int, int, int],
) -> bool:
    def menu_is_open() -> Any | None:
        quick_action_list = find_quick_action_list(window, search_depth=8, exists_timeout=0.05)
        if quick_action_list is not None:
            return quick_action_list
        try:
            return find_add_friend_entry(auto, window, window_rect, menu_region)
        except Exception:
            return None

    return wait_for_match(menu_is_open, timeout=1.2, interval=0.12) is not None


def open_quick_action_menu(
    auto: Any,
    window: Any,
    window_name: str,
    logs: list[AutomationLog],
    *,
    context_code_prefix: str = "quick_action",
) -> tuple[Any, tuple[int, int, int, int], dict[str, Any]]:
    window_rect = get_rect_tuple(window)
    if not window_rect:
        raise RuntimeError("无法读取微信窗口坐标，无法定位快捷操作菜单")

    click_target = find_plus_button(window)
    click_target_summary = describe_control(click_target)
    plus_rect = get_rect_tuple(click_target)
    menu_region = build_menu_probe_region(window_rect, plus_rect)
    data: dict[str, Any] = {
        "windowName": window_name,
        "windowRect": window_rect,
        "quickActionButton": serialize_probe_node(click_target, 0, "window"),
        "quickActionButtonRect": plus_rect,
        "menuRegion": menu_region,
        "menuOpened": False,
    }

    append_log(
        logs,
        "info",
        f"已定位“快捷操作”按钮: {click_target_summary}",
        code=f"{context_code_prefix}_button_found",
        details={
            "control": click_target_summary,
            "rect": plus_rect,
            "center": ((plus_rect[0] + plus_rect[2]) // 2, (plus_rect[1] + plus_rect[3]) // 2) if plus_rect else None,
            "menuRegion": menu_region,
        },
    )

    click_diagnostics = click_control(auto, click_target, prefer_rect_center=True)
    data["clickDiagnostics"] = click_diagnostics
    append_log(
        logs,
        "info",
        "已执行快捷操作按钮中心点点击",
        code=f"{context_code_prefix}_button_clicked",
        details=click_diagnostics,
    )

    time.sleep(0.15)
    menu_opened = wait_for_quick_action_menu(window, auto, window_rect, menu_region)
    fallback_click_diagnostics = None
    physical_click_diagnostics = None

    if not menu_opened:
        fallback_click_diagnostics = click_control(auto, click_target, prefer_rect_center=False)
        data["fallbackClickDiagnostics"] = fallback_click_diagnostics
        append_log(
            logs,
            "warn",
            "首次点击后未检测到菜单，已尝试使用控件 Click 方式再次点击",
            code=f"{context_code_prefix}_fallback_click_attempted",
            details=fallback_click_diagnostics,
        )
        time.sleep(0.15)
        menu_opened = wait_for_quick_action_menu(window, auto, window_rect, menu_region)

    if not menu_opened:
        physical_click_diagnostics = physical_click_rect_center(auto, click_target)
        data["physicalClickDiagnostics"] = physical_click_diagnostics
        append_log(
            logs,
            "warn",
            "控件 Click 后仍未检测到菜单，已尝试 Win32 物理鼠标点击",
            code=f"{context_code_prefix}_physical_click_attempted",
            details=physical_click_diagnostics,
        )
        time.sleep(0.2)
        menu_opened = wait_for_quick_action_menu(window, auto, window_rect, menu_region)

    data["menuOpened"] = menu_opened
    if menu_opened:
        append_log(
            logs,
            "info",
            "已检测到快捷操作菜单展开",
            code=f"{context_code_prefix}_menu_opened",
            details={
                "usedFallbackClick": fallback_click_diagnostics is not None,
                "usedPhysicalClick": physical_click_diagnostics is not None,
            },
        )
    else:
        try:
            probe_region, plus_button_node, related_controls = collect_add_friend_menu_probe(auto, window, window_name)
        except Exception as error:
            probe_region = menu_region
            plus_button_node = None
            related_controls = []
            append_log(
                logs,
                "warn",
                f"菜单未展开后采集相关控件失败: {error}",
                code=f"{context_code_prefix}_menu_probe_failed_after_click",
            )
        data["postClickProbeRegion"] = probe_region
        data["postClickPlusButton"] = plus_button_node
        data["postClickRelatedControls"] = related_controls[:30]
        append_log(
            logs,
            "warn",
            "已点击“快捷操作”按钮，但未检测到菜单展开",
            code=f"{context_code_prefix}_menu_not_opened",
            details={
                "clickDiagnostics": click_diagnostics,
                "fallbackClickDiagnostics": fallback_click_diagnostics,
                "physicalClickDiagnostics": physical_click_diagnostics,
                "menuRegion": menu_region,
                "relatedControlCount": len(related_controls),
                "relatedControls": related_controls[:10],
            },
        )

    return click_target, menu_region, data

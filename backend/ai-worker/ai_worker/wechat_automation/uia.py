from __future__ import annotations

import ctypes
import time
from typing import Any, Callable, Iterable

from .models import AutomationLog, ProbeNode, Rect


def load_auto():
    try:
        import uiautomation as auto
    except Exception as error:  # pragma: no cover - environment dependent
        raise RuntimeError(f"导入 uiautomation 失败: {error}") from error
    return auto


def append_log(
    logs: list[AutomationLog],
    level: AutomationLog["level"],
    message: str,
    *,
    code: str | None = None,
    details: dict[str, Any] | None = None,
) -> None:
    payload: AutomationLog = {
        "level": level,
        "message": message,
    }
    if code:
        payload["code"] = code
    if details:
        payload["details"] = details
    logs.append(payload)


def find_window(auto: Any, window_name: str):
    window = auto.WindowControl(searchDepth=1, Name=window_name)
    if not window.Exists(3):
        raise RuntimeError(f"未找到窗口: {window_name}")
    return window


def find_named_window(auto: Any, names: tuple[str, ...]) -> Any | None:
    window_factory = getattr(auto, "WindowControl", None)
    if callable(window_factory):
        for name in names:
            try:
                control = window_factory(searchDepth=3, Name=name)
            except Exception:
                control = None
            if control is not None and control.Exists(0.3):
                return control

    root = auto.GetRootControl()
    for control, _depth in iter_controls(root, max_depth=6):
        if control_type(control) != "WindowControl":
            continue
        if control_name(control) in names:
            return control
    return None


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


def activate_window(window: Any) -> None:
    window.SetActive()
    time.sleep(0.12)


def get_runtime_snapshot(auto: Any) -> dict[str, Any]:
    snapshot: dict[str, Any] = {}

    position_getter = getattr(auto, "GetCursorPos", None)
    if callable(position_getter):
        try:
            position = position_getter()
            snapshot["cursorPosition"] = (
                getattr(position, "x", getattr(position, "X", None)),
                getattr(position, "y", getattr(position, "Y", None)),
            )
        except Exception as error:
            snapshot["cursorPositionError"] = str(error)

    foreground_getter = getattr(auto, "GetForegroundControl", None)
    if callable(foreground_getter):
        try:
            foreground = foreground_getter()
            snapshot["foreground"] = describe_control(foreground)
        except Exception as error:
            snapshot["foregroundError"] = str(error)

    return snapshot


def iter_controls(control: Any, depth: int = 0, max_depth: int = 5) -> Iterable[tuple[Any, int]]:
    if depth > max_depth:
        return

    for child in control.GetChildren():
        yield child, depth
        yield from iter_controls(child, depth + 1, max_depth)


def iter_descendants(control: Any, max_depth: int = 12) -> Iterable[Any]:
    for child, _depth in iter_controls(control, max_depth=max_depth):
        yield child


def wait_for_match(search_fn: Callable[[], Any | None], timeout: float = 3.0, interval: float = 0.2) -> Any | None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            result = search_fn()
        except Exception:
            result = None
        if result is not None:
            return result
        time.sleep(interval)
    return None


def get_rect_tuple(control: Any) -> Rect | None:
    rect = getattr(control, "BoundingRectangle", None)
    if callable(rect):
        rect = rect()
    if rect is None and hasattr(control, "GetBoundingRectangle"):
        rect = control.GetBoundingRectangle()
    if rect is None:
        return None

    left = getattr(rect, "left", getattr(rect, "Left", None))
    top = getattr(rect, "top", getattr(rect, "Top", None))
    right = getattr(rect, "right", getattr(rect, "Right", None))
    bottom = getattr(rect, "bottom", getattr(rect, "Bottom", None))
    if None in (left, top, right, bottom):
        return None
    return int(left), int(top), int(right), int(bottom)


def rect_intersects(a: Rect, b: Rect) -> bool:
    return not (a[2] < b[0] or a[0] > b[2] or a[3] < b[1] or a[1] > b[3])


def rect_center(rect: Rect) -> tuple[int, int]:
    return ((rect[0] + rect[2]) // 2, (rect[1] + rect[3]) // 2)


def rect_center_within(rect: Rect, container: Rect, tolerance: int = 0) -> bool:
    center_x, center_y = rect_center(rect)
    return (
        container[0] - tolerance <= center_x <= container[2] + tolerance
        and container[1] - tolerance <= center_y <= container[3] + tolerance
    )


def is_same_row(rect: Rect, anchor_rect: Rect, tolerance: int = 18) -> bool:
    rect_center_y = (rect[1] + rect[3]) // 2
    anchor_center_y = (anchor_rect[1] + anchor_rect[3]) // 2
    return abs(rect_center_y - anchor_center_y) <= tolerance


def control_name(control: Any) -> str:
    return (getattr(control, "Name", "") or "").strip()


def control_type(control: Any) -> str:
    return (getattr(control, "ControlTypeName", "") or "").strip()


def control_class(control: Any) -> str:
    return (getattr(control, "ClassName", "") or "").strip()


def describe_control(control: Any) -> str:
    rect = get_rect_tuple(control)
    rect_text = f" rect={rect}" if rect else ""
    return (
        f"name={control_name(control)!r}"
        f" type={control_type(control)!r}"
        f" class={control_class(control)!r}{rect_text}"
    )


def serialize_probe_node(control: Any, depth: int, source: str) -> ProbeNode:
    return {
        "name": control_name(control),
        "automationId": getattr(control, "AutomationId", "") or "",
        "className": control_class(control),
        "controlType": control_type(control),
        "depth": depth,
        "source": source,
        "rect": get_rect_tuple(control),
    }


def replace_text(auto: Any, control: Any, value: str) -> None:
    control.Click(simulateMove=False)
    time.sleep(0.2)

    value_pattern_getter = getattr(control, "GetValuePattern", None)
    if callable(value_pattern_getter):
        try:
            value_pattern = value_pattern_getter()
        except Exception:
            value_pattern = None
        if value_pattern is not None:
            set_value = getattr(value_pattern, "SetValue", None)
            if callable(set_value):
                try:
                    set_value("")
                    time.sleep(0.1)
                    set_value(value)
                    return
                except Exception:
                    pass

    direct_set_value = getattr(control, "SetValue", None)
    if callable(direct_set_value):
        try:
            direct_set_value(value)
            return
        except Exception:
            pass

    try:
        control.SendKeys(value)
        return
    except Exception:
        pass

    auto.SendKeys("{Del}")
    time.sleep(0.1)
    auto.SendKeys(value)


def click_control(auto: Any, control: Any, *, prefer_rect_center: bool = False) -> dict[str, Any]:
    diagnostics: dict[str, Any] = {
        "preferRectCenter": prefer_rect_center,
        "control": describe_control(control),
        "rect": get_rect_tuple(control),
        "method": None,
        "center": None,
        "focusAttempted": False,
        "focusSucceeded": None,
        "errors": [],
    }
    diagnostics["beforeSnapshot"] = get_runtime_snapshot(auto)

    set_focus = getattr(control, "SetFocus", None)
    if callable(set_focus):
        diagnostics["focusAttempted"] = True
        try:
            set_focus()
            diagnostics["focusSucceeded"] = True
            time.sleep(0.05)
        except Exception as error:
            diagnostics["focusSucceeded"] = False
            diagnostics["errors"].append(f"SetFocus failed: {error}")

    if prefer_rect_center:
        rect = get_rect_tuple(control)
        click_fn = getattr(auto, "Click", None)
        if rect is not None and callable(click_fn):
            center_x, center_y = rect_center(rect)
            diagnostics["center"] = (center_x, center_y)
            try:
                click_fn(center_x, center_y)
                diagnostics["method"] = "auto.Click(rect_center)"
                time.sleep(0.05)
                diagnostics["afterSnapshot"] = get_runtime_snapshot(auto)
                return diagnostics
            except Exception as error:
                diagnostics["errors"].append(f"auto.Click failed: {error}")

    control.Click(simulateMove=False)
    diagnostics["method"] = "control.Click(simulateMove=False)"
    time.sleep(0.05)
    diagnostics["afterSnapshot"] = get_runtime_snapshot(auto)
    return diagnostics


def physical_click_rect_center(auto: Any, control: Any) -> dict[str, Any]:
    rect = get_rect_tuple(control)
    diagnostics: dict[str, Any] = {
        "control": describe_control(control),
        "rect": rect,
        "method": "win32.mouse_event(left_down_up)",
        "center": None,
        "beforeSnapshot": get_runtime_snapshot(auto),
        "afterSnapshot": None,
        "errors": [],
    }
    if rect is None:
        diagnostics["errors"].append("control rect is unavailable")
        return diagnostics

    center_x, center_y = rect_center(rect)
    diagnostics["center"] = (center_x, center_y)
    try:
        user32 = ctypes.windll.user32
        user32.SetCursorPos(center_x, center_y)
        time.sleep(0.05)
        user32.mouse_event(0x0002, 0, 0, 0, 0)
        time.sleep(0.08)
        user32.mouse_event(0x0004, 0, 0, 0, 0)
        time.sleep(0.08)
    except Exception as error:
        diagnostics["errors"].append(f"physical click failed: {error}")

    diagnostics["afterSnapshot"] = get_runtime_snapshot(auto)
    return diagnostics


def click_first_existing(control_factories: list[tuple[Any, dict[str, Any]]], timeout: float = 0.3) -> Any | None:
    for factory, kwargs in control_factories:
        if not callable(factory):
            continue
        try:
            control = factory(**kwargs)
        except Exception:
            continue
        if control.Exists(timeout):
            control.Click(simulateMove=False)
            return control
    return None


def summarize_controls(controls: list[Any], limit: int = 5) -> str:
    return "; ".join(describe_control(control) for control in controls[:limit])


def close_window_gracefully(window: Any) -> bool:
    close_method = getattr(window, "Close", None)
    if callable(close_method):
        try:
            close_method()
            return True
        except Exception:
            pass

    window_pattern_getter = getattr(window, "GetWindowPattern", None)
    if callable(window_pattern_getter):
        try:
            window_pattern = window_pattern_getter()
        except Exception:
            window_pattern = None
        if window_pattern is not None:
            close_method = getattr(window_pattern, "Close", None)
            if callable(close_method):
                try:
                    close_method()
                    return True
                except Exception:
                    pass

    return False

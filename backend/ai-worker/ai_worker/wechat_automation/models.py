from __future__ import annotations

from typing import Any, Literal, TypedDict

Rect = tuple[int, int, int, int]


class AutomationLog(TypedDict, total=False):
    level: Literal["info", "warn", "error"]
    message: str
    code: str
    details: dict[str, Any]


class ProbeNode(TypedDict, total=False):
    name: str
    automationId: str
    className: str
    controlType: str
    depth: int
    source: str
    rect: Rect | None

from __future__ import annotations

from typing import Any, Callable

from .models import AutomationLog


ToolHandler = Callable[..., tuple[list[AutomationLog], dict[str, Any]]]


def run_tool(handler: ToolHandler, *args: Any, success_message: str | None = None, **kwargs: Any) -> dict[str, Any]:
    logs, data = handler(*args, **kwargs)
    return {
        "ok": True,
        "message": success_message,
        "logs": logs,
        "data": data,
    }

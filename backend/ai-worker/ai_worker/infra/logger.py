import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def _default_logs_dir() -> Path:
    current = Path(__file__).resolve()
    project_root = current.parents[4]
    return project_root / "backend" / "base" / "logs"


LOGS_DIR = Path(os.environ.get("AI_WORKER_LOG_DIR") or _default_logs_dir())
LOGS_DIR.mkdir(parents=True, exist_ok=True)


def _safe_json(context: dict[str, Any] | None) -> str:
    if not context:
        return ""
    def normalize(value: Any):
        if isinstance(value, str) and len(value) > 1200:
            return f"{value[:1200]}...<truncated:{len(value)}>"
        return value
    return json.dumps({key: normalize(value) for key, value in context.items()}, ensure_ascii=False)


def log(level: str, message: str, context: dict[str, Any] | None = None):
    line = " ".join(filter(None, [
        datetime.now(timezone.utc).isoformat(),
        level.upper(),
        message,
        _safe_json(context),
    ]))
    with (LOGS_DIR / "ai-worker.log").open("a", encoding="utf-8") as file:
        file.write(f"{line}\n")


def info(message: str, context: dict[str, Any] | None = None):
    log("info", message, context)


def warning(message: str, context: dict[str, Any] | None = None):
    log("warn", message, context)


def error(message: str, context: dict[str, Any] | None = None):
    log("error", message, context)

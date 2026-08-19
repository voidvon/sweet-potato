from dataclasses import dataclass
import os
from pathlib import Path


def _load_env_file(path: Path):
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        value = line.strip()
        if not value or value.startswith("#") or "=" not in value:
            continue
        key, raw = value.split("=", 1)
        key = key.strip()
        raw = raw.strip().strip("'").strip('"')
        if key and key not in os.environ:
            os.environ[key] = raw


for env_path in [
    Path(os.environ["ENV_FILE"]).expanduser() if os.environ.get("ENV_FILE") else None,
    Path.cwd() / ".env",
    Path(__file__).resolve().parents[1] / ".env",
]:
    if env_path:
        _load_env_file(env_path)


@dataclass(frozen=True)
class WorkerSettings:
    host: str = os.environ.get("PYTHON_AI_WORKER_HOST", "127.0.0.1")
    port: int = int(os.environ.get("PYTHON_AI_WORKER_PORT") or os.environ.get("SERVICE_PORT", "7073"))
    vod_space_name: str = (
        os.environ.get("VOLCENGINE_VOD_SPACE_NAME")
        or os.environ.get("VOD_SPACE_NAME")
        or os.environ.get("VOD_SPACE")
        or ""
    )
    vod_region: str = os.environ.get("VOLCENGINE_VOD_REGION") or os.environ.get("VOLC_REGION") or ""
    vod_upload_host_prefer: str = os.environ.get("VOLCENGINE_VOD_UPLOAD_HOST_PREFER", "").strip()


settings = WorkerSettings()

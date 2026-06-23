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


def _default_backend_base_dir() -> Path:
    current = Path(__file__).resolve()
    backend_root = current.parents[2]
    return backend_root / "base"


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
    max_keyframes: int = int(os.environ.get("VIDEO_PARSE_MAX_KEYFRAMES", "9"))
    keyframe_interval_seconds: int = int(os.environ.get("VIDEO_PARSE_KEYFRAME_INTERVAL_SECONDS", "3"))
    whisper_model: str = os.environ.get("VIDEO_PARSE_WHISPER_MODEL", "base")
    whisper_language: str = os.environ.get("VIDEO_PARSE_LANGUAGE", "zh")
    videodata_dir: str = os.environ.get("AI_WORKER_VIDEODATA_DIR", str(_default_backend_base_dir() / "videodata"))
    douyin_cookies: str = os.environ.get("DOUYIN_COOKIES", "")
    request_timeout: int = int(os.environ.get("REQUEST_TIMEOUT", "15"))
    vod_space_name: str = (
        os.environ.get("VOLCENGINE_VOD_SPACE_NAME")
        or os.environ.get("VOD_SPACE_NAME")
        or os.environ.get("VOD_SPACE")
        or ""
    )
    vod_region: str = os.environ.get("VOLCENGINE_VOD_REGION") or os.environ.get("VOLC_REGION") or ""
    vod_upload_host_prefer: str = os.environ.get("VOLCENGINE_VOD_UPLOAD_HOST_PREFER", "").strip()
    vod_doubao_endpoint: str = os.environ.get("VOLCENGINE_VOD_DOUBAO_ENDPOINT", "").strip()
    vod_asr_app_id: str = os.environ.get("VOLCENGINE_VOD_ASR_APP_ID", "").strip()
    vod_asr_app_type: str = os.environ.get("VOLCENGINE_VOD_ASR_APP_TYPE", "volc.bigasr.sauc.duration").strip()
    vod_understanding_snapshot_resolution: str = os.environ.get("VOLCENGINE_VOD_UNDERSTANDING_SNAPSHOT_RESOLUTION", "240p").strip()
    vod_understanding_snapshot_fps: float = float(os.environ.get("VOLCENGINE_VOD_UNDERSTANDING_SNAPSHOT_FPS", "1"))


settings = WorkerSettings()

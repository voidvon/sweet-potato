import base64
import hashlib
import json
import mimetypes
import os
import shutil
import subprocess
import urllib.parse
import urllib.request
from typing import Any

from ai_worker.config import settings
from ai_worker.domain.errors import VideoUnavailableError
from ai_worker.domain.video_inspection import Keyframe, TranscriptSegment, Transcription, VideoInfo


VIDEO_EXTENSIONS = {".mp4", ".mov", ".m4v", ".webm", ".mkv"}


def has_command(name: str) -> bool:
    return shutil.which(name) is not None


def run_command(command: list[str], timeout: int = 180) -> str:
    completed = subprocess.run(
        command,
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        timeout=timeout,
    )
    if completed.returncode != 0:
        message = completed.stderr.strip() or completed.stdout.strip() or f"命令执行失败：{' '.join(command)}"
        raise VideoUnavailableError(message)
    return completed.stdout


def is_direct_video_url(url: str) -> bool:
    extension = os.path.splitext(urllib.parse.urlparse(url).path)[1].lower()
    return extension in VIDEO_EXTENSIONS


def stable_video_workspace(url: str) -> str:
    digest = hashlib.sha256(url.strip().encode("utf-8")).hexdigest()[:24]
    workspace = os.path.join(settings.videodata_dir, digest)
    os.makedirs(workspace, exist_ok=True)
    return workspace


def find_existing_video(output_dir: str) -> str:
    candidates = [
        os.path.join(output_dir, name)
        for name in os.listdir(output_dir)
        if os.path.splitext(name)[1].lower() in VIDEO_EXTENSIONS and os.path.getsize(os.path.join(output_dir, name)) > 0
    ]
    return max(candidates, key=lambda item: os.path.getsize(item)) if candidates else ""


def download_video(url: str, output_dir: str) -> tuple[str, dict]:
    existing = find_existing_video(output_dir)
    metadata_path = os.path.join(output_dir, "metadata.json")
    if existing:
        info = {}
        if os.path.exists(metadata_path):
            try:
                with open(metadata_path, "r", encoding="utf-8") as file:
                    info = json.load(file)
            except Exception:
                info = {}
        return existing, info
    if is_direct_video_url(url):
        video_path, info = download_direct_video(url, output_dir)
    elif has_command("yt-dlp"):
        video_path, info = download_with_ytdlp(url, output_dir)
    else:
        raise VideoUnavailableError("无法解析：服务端未安装 yt-dlp，不能解析抖音/B站/小红书等平台视频 URL；请安装 yt-dlp 或提供直连视频文件 URL")
    with open(metadata_path, "w", encoding="utf-8") as file:
        json.dump(info, file, ensure_ascii=False, indent=2)
    return video_path, info


def download_direct_video(url: str, output_dir: str) -> tuple[str, dict]:
    extension = os.path.splitext(urllib.parse.urlparse(url).path)[1].lower() or ".mp4"
    output_path = os.path.join(output_dir, f"source{extension}")
    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(request, timeout=60) as response:
        content_type = response.headers.get("Content-Type", "")
        if "video" not in content_type and not is_direct_video_url(url):
            raise VideoUnavailableError("无法解析：该 URL 不是直连视频文件，服务端需要安装 yt-dlp 才能解析平台视频")
        with open(output_path, "wb") as target:
            shutil.copyfileobj(response, target)
    return output_path, {
        "title": os.path.basename(urllib.parse.urlparse(url).path) or "直连视频",
        "description": "",
        "uploader": "",
        "webpage_url": url,
        "tags": [],
    }


def download_with_ytdlp(url: str, output_dir: str) -> tuple[str, dict]:
    output_template = os.path.join(output_dir, "source.%(ext)s")
    info = json.loads(run_command([
        "yt-dlp",
        "--dump-single-json",
        "--skip-download",
        "--no-warnings",
        url,
    ], timeout=120))
    run_command([
        "yt-dlp",
        "--no-warnings",
        "-f",
        "bestvideo[height<=720]+bestaudio/best[height<=720]/best",
        "--merge-output-format",
        "mp4",
        "-o",
        output_template,
        url,
    ], timeout=300)
    candidates = [
        os.path.join(output_dir, name)
        for name in os.listdir(output_dir)
        if os.path.splitext(name)[1].lower() in VIDEO_EXTENSIONS
    ]
    if not candidates:
        raise VideoUnavailableError("无法解析：yt-dlp 未生成可用视频文件")
    return max(candidates, key=lambda item: os.path.getsize(item)), info


def probe_video(video_path: str) -> dict:
    if not has_command("ffprobe"):
        return {}
    try:
        data = json.loads(run_command([
            "ffprobe",
            "-v",
            "error",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
            video_path,
        ], timeout=60))
    except Exception as error:
        return {"probeError": str(error)}
    streams = data.get("streams") if isinstance(data, dict) else []
    video_stream = next((item for item in streams if item.get("codec_type") == "video"), {})
    audio_stream = next((item for item in streams if item.get("codec_type") == "audio"), {})
    duration = data.get("format", {}).get("duration") if isinstance(data.get("format"), dict) else None
    return {
        "duration": float(duration) if duration else 0,
        "width": int(video_stream.get("width") or 0),
        "height": int(video_stream.get("height") or 0),
        "hasAudio": bool(audio_stream),
    }


def build_video_info(video_path: str, source_url: str, info: dict, metadata: dict) -> VideoInfo:
    return VideoInfo(
        title=info.get("title") or os.path.basename(video_path),
        description=info.get("description") or "",
        uploader=info.get("uploader") or info.get("channel") or "",
        webpageUrl=info.get("webpage_url") or source_url,
        tags=info.get("tags") if isinstance(info.get("tags"), list) else [],
        duration=metadata.get("duration") or info.get("duration") or 0,
        width=metadata.get("width") or info.get("width") or 0,
        height=metadata.get("height") or info.get("height") or 0,
        fileSize=os.path.getsize(video_path),
        mimeType=mimetypes.guess_type(video_path)[0] or "video/mp4",
        hasAudio=bool(metadata.get("hasAudio", False)),
    )


def extract_keyframes(video_path: str, output_dir: str) -> list[Keyframe]:
    if not has_command("ffmpeg"):
        raise VideoUnavailableError("无法解析：服务端未安装 ffmpeg，不能抽取视频关键帧")
    frame_dir = os.path.join(output_dir, "frames")
    os.makedirs(frame_dir, exist_ok=True)
    existing_frames = sorted(
        name for name in os.listdir(frame_dir)
        if os.path.splitext(name)[1].lower() in {".jpg", ".jpeg"}
    )
    if existing_frames:
        return read_keyframes(frame_dir, existing_frames)
    output_pattern = os.path.join(frame_dir, "frame-%03d.jpg")
    try:
        run_command([
            "ffmpeg",
            "-y",
            "-i",
            video_path,
            "-vf",
            f"fps=1/{settings.keyframe_interval_seconds},scale='min(720,iw)':-2",
            "-frames:v",
            str(settings.max_keyframes),
            "-q:v",
            "3",
            output_pattern,
        ], timeout=180)
    except Exception:
        run_command([
            "ffmpeg",
            "-y",
            "-ss",
            "0",
            "-i",
            video_path,
            "-frames:v",
            "1",
            "-vf",
            "scale='min(720,iw)':-2",
            os.path.join(frame_dir, "frame-001.jpg"),
        ], timeout=120)
    return read_keyframes(frame_dir, sorted(os.listdir(frame_dir))[:settings.max_keyframes])


def _safe_float(value: Any, default: float = 0) -> float:
    try:
        number = float(value)
        return number if number == number else default
    except Exception:
        return default


def _safe_int(value: Any, default: int = 0) -> int:
    try:
        return int(round(float(value)))
    except Exception:
        return default


def _clamp_int(value: int, minimum: int, maximum: int) -> int:
    return max(minimum, min(maximum, value))


def extract_picture_in_picture_assets(video_path: str, items: list[dict], output_dir: str) -> dict:
    if not has_command("ffmpeg"):
        return {"ok": False, "message": "服务端未安装 ffmpeg，无法提取画中画素材", "items": []}
    if not os.path.exists(video_path) or os.path.getsize(video_path) <= 0:
        return {"ok": False, "message": "本地视频文件不存在，无法提取画中画素材", "items": []}
    metadata = probe_video(video_path)
    video_width = int(metadata.get("width") or 0)
    video_height = int(metadata.get("height") or 0)
    duration = float(metadata.get("duration") or 0)
    pip_dir = os.path.join(output_dir, "picture_in_picture")
    os.makedirs(pip_dir, exist_ok=True)
    extracted: list[dict] = []
    for index, item in enumerate(items[:20]):
        if not isinstance(item, dict):
            continue
        start = max(0, _safe_float(item.get("startSecond") or item.get("start") or item.get("time") or 0))
        end = _safe_float(item.get("endSecond") or item.get("end") or 0)
        if end <= start:
            end = start + 2
        if duration:
            start = min(start, max(0, duration - 0.1))
            end = min(max(end, start + 0.1), duration)
        x = _safe_int(item.get("x"))
        y = _safe_int(item.get("y"))
        width = _safe_int(item.get("width"))
        height = _safe_int(item.get("height"))
        if video_width and video_height:
            x = _clamp_int(x, 0, max(0, video_width - 1))
            y = _clamp_int(y, 0, max(0, video_height - 1))
            width = _clamp_int(width, 1, max(1, video_width - x))
            height = _clamp_int(height, 1, max(1, video_height - y))
        if width <= 0 or height <= 0:
            extracted.append({
                **item,
                "extractionOk": False,
                "extractionError": "缺少有效的画中画坐标或尺寸，无法裁切",
            })
            continue
        item_id = str(item.get("id") or f"pip_{index + 1}").replace("/", "_").replace(" ", "_")
        frame_path = os.path.join(pip_dir, f"{item_id}_frame.jpg")
        clip_path = os.path.join(pip_dir, f"{item_id}_clip.mp4")
        crop_filter = f"crop={width}:{height}:{x}:{y}"
        try:
            if not os.path.exists(frame_path) or os.path.getsize(frame_path) == 0:
                run_command([
                    "ffmpeg",
                    "-y",
                    "-ss",
                    f"{start:.3f}",
                    "-i",
                    video_path,
                    "-frames:v",
                    "1",
                    "-vf",
                    crop_filter,
                    "-q:v",
                    "3",
                    frame_path,
                ], timeout=60)
            if not os.path.exists(clip_path) or os.path.getsize(clip_path) == 0:
                run_command([
                    "ffmpeg",
                    "-y",
                    "-ss",
                    f"{start:.3f}",
                    "-t",
                    f"{max(0.1, end - start):.3f}",
                    "-i",
                    video_path,
                    "-vf",
                    crop_filter,
                    "-an",
                    "-movflags",
                    "+faststart",
                    clip_path,
                ], timeout=120)
            extracted.append({
                **item,
                "startSecond": round(start, 3),
                "endSecond": round(end, 3),
                "x": x,
                "y": y,
                "width": width,
                "height": height,
                "extractionOk": True,
                "framePath": frame_path,
                "clipPath": clip_path,
            })
        except Exception as error:
            extracted.append({
                **item,
                "startSecond": round(start, 3),
                "endSecond": round(end, 3),
                "x": x,
                "y": y,
                "width": width,
                "height": height,
                "extractionOk": False,
                "extractionError": str(error),
            })
    return {
        "ok": True,
        "video": {
            "width": video_width,
            "height": video_height,
            "duration": duration,
        },
        "items": extracted,
    }


def read_keyframes(frame_dir: str, names: list[str]) -> list[Keyframe]:
    frames: list[Keyframe] = []
    for index, name in enumerate(names[:settings.max_keyframes]):
        frame_path = os.path.join(frame_dir, name)
        if os.path.splitext(name)[1].lower() not in {".jpg", ".jpeg"}:
            continue
        with open(frame_path, "rb") as frame_file:
            data_uri = "data:image/jpeg;base64," + base64.b64encode(frame_file.read()).decode("utf-8")
        frames.append(Keyframe(
            index=index,
            time=round(index * settings.keyframe_interval_seconds, 2),
            mimeType="image/jpeg",
            dataUri=data_uri,
        ))
    if not frames:
        raise VideoUnavailableError("无法解析：没有提取到可用关键帧")
    return frames


def read_transcription_cache(transcript_path: str) -> Transcription | None:
    if os.path.exists(transcript_path):
        try:
            with open(transcript_path, "r", encoding="utf-8") as file:
                cached = json.load(file)
            return Transcription(
                text=str(cached.get("text") or ""),
                segments=[
                    TranscriptSegment(
                        start=float(item.get("start") or 0),
                        end=float(item.get("end") or 0),
                        text=str(item.get("text") or ""),
                    )
                    for item in cached.get("segments", [])
                    if isinstance(item, dict)
                ],
                error=str(cached.get("error") or ""),
            )
        except Exception:
            return None
    return None


def transcribe_audio_file(audio_path: str, transcript_path: str) -> Transcription:
    cached = read_transcription_cache(transcript_path)
    if cached:
        return cached
    if not os.path.exists(audio_path) or os.path.getsize(audio_path) == 0:
        return Transcription(text="", error="未提取到可用音频")
    try:
        import whisper  # type: ignore
        model = whisper.load_model(settings.whisper_model)
        result = model.transcribe(audio_path, language=settings.whisper_language or None)
        segments = [
            TranscriptSegment(
                start=float(segment.get("start", 0)),
                end=float(segment.get("end", 0)),
                text=str(segment.get("text", "")).strip(),
            )
            for segment in result.get("segments", [])
            if str(segment.get("text", "")).strip()
        ]
        transcription = Transcription(text=result.get("text", ""), segments=segments)
        write_transcription_cache(transcript_path, transcription)
        return transcription
    except Exception as error:
        transcription = Transcription(text="", error=f"已提取音频，但未完成语音识别：{error}")
        write_transcription_cache(transcript_path, transcription)
        return transcription


def extract_transcription(video_path: str, output_dir: str) -> Transcription:
    if not has_command("ffmpeg"):
        return Transcription(text="", error="服务端未安装 ffmpeg，无法提取音频")
    audio_path = os.path.join(output_dir, "audio.wav")
    transcript_path = os.path.join(output_dir, "transcription.json")
    cached = read_transcription_cache(transcript_path)
    if cached:
        return cached
    try:
        if not os.path.exists(audio_path) or os.path.getsize(audio_path) == 0:
            run_command([
                "ffmpeg",
                "-y",
                "-i",
                video_path,
                "-vn",
                "-acodec",
                "pcm_s16le",
                "-ar",
                "16000",
                "-ac",
                "1",
                audio_path,
            ], timeout=180)
    except Exception as error:
        return Transcription(text="", error=f"音频提取失败：{error}")
    return transcribe_audio_file(audio_path, transcript_path)


def download_audio_track(audio_url: str, output_dir: str) -> str:
    audio_dir = os.path.join(output_dir, "audio_track")
    os.makedirs(audio_dir, exist_ok=True)
    parsed = urllib.parse.urlparse(audio_url)
    extension = os.path.splitext(parsed.path)[1].lower() or ".mp3"
    if extension not in {".mp3", ".m4a", ".aac", ".wav", ".ogg", ".opus"}:
        extension = ".mp3"
    output_path = os.path.join(audio_dir, f"source{extension}")
    if os.path.exists(output_path) and os.path.getsize(output_path) > 0:
        return output_path
    request = urllib.request.Request(audio_url, headers={"User-Agent": "Mozilla/5.0", "Referer": "https://www.douyin.com/"})
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            with open(output_path, "wb") as target:
                shutil.copyfileobj(response, target)
        return output_path
    except Exception as error:
        raise VideoUnavailableError(f"音频轨下载失败：{error}") from error


def transcribe_audio_url(audio_url: str, output_dir: str) -> Transcription:
    if not audio_url:
        return Transcription(text="", error="无可用音频轨")
    audio_path = download_audio_track(audio_url, output_dir)
    transcript_path = os.path.join(output_dir, "audio_track_transcription.json")
    return transcribe_audio_file(audio_path, transcript_path)


def write_transcription_cache(transcript_path: str, transcription: Transcription):
    with open(transcript_path, "w", encoding="utf-8") as file:
        json.dump({
            "text": transcription.text,
            "segments": [
                {"start": segment.start, "end": segment.end, "text": segment.text}
                for segment in transcription.segments
            ],
            "error": transcription.error,
        }, file, ensure_ascii=False, indent=2)

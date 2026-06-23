import json
import os
import re
import urllib.parse
from json import JSONDecodeError

import requests

from ai_worker.config import settings
from ai_worker.domain.errors import VideoUnavailableError
from ai_worker.domain.video_inspection import Keyframe, TranscriptSegment, Transcription, VideoInfo, VideoInspection
from ai_worker.infra.cookie_pool import cookie_pool
from ai_worker.infra import logger
from ai_worker.infra import media_tools
from ai_worker.infra.media_tools import stable_video_workspace

DOUYIN_MATERIAL_CACHE_VERSION = 4


def is_douyin_url(url: str) -> bool:
    host = urllib.parse.urlparse(url).netloc.lower()
    return "douyin.com" in host


def douyin_headers(cookie: str) -> dict:
    return {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        "Referer": "https://www.douyin.com/",
        "Cookie": cookie,
    }


def extract_aweme_id(url: str, trace_id: str = "") -> str:
    current_url = url
    if "v.douyin.com" in urllib.parse.urlparse(current_url).netloc.lower():
        try:
            response = requests.head(current_url, allow_redirects=True, timeout=settings.request_timeout)
            current_url = response.url
            logger.info("douyin short url resolved", {"traceId": trace_id, "url": url, "resolvedUrl": current_url})
        except Exception as error:
            raise VideoUnavailableError(f"无法解析：抖音短链接跳转失败（{error}）") from error

    parsed = urllib.parse.urlparse(current_url)
    query = urllib.parse.parse_qs(parsed.query)
    for key in ("aweme_id", "modal_id", "item_id", "video_id"):
        value = query.get(key, [""])[0]
        if value and value.isdigit():
            return value

    match = re.search(r"/video/(\d+)", parsed.path) or re.search(r"/note/(\d+)", parsed.path)
    if not match:
        raise VideoUnavailableError("无法解析：未从抖音链接中提取到 aweme_id")
    return match.group(1)


def _first_url(value: object) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        url_list = value.get("url_list")
        if isinstance(url_list, list) and url_list:
            return str(url_list[0])
        for key in ("url", "uri"):
            if isinstance(value.get(key), str):
                return str(value[key])
    return ""


def _extract_keyframe_urls(video: dict) -> list[str]:
    raw_frames = video.get("key_frames") or video.get("key_frame") or []
    urls: list[str] = []
    if isinstance(raw_frames, list):
        for item in raw_frames:
            if isinstance(item, str):
                urls.append(item)
            elif isinstance(item, dict):
                urls.append(_first_url(item.get("url") or item.get("image") or item.get("cover") or item))
    return [url for url in urls if url]


def _extract_subtitle_url(video: dict, aweme: dict) -> str:
    for value in (
        video.get("subtitle_url"),
        aweme.get("subtitle_url"),
        video.get("caption_url"),
    ):
        url = _first_url(value)
        if url:
            return url
    subtitles = aweme.get("video_labels") or aweme.get("text_extra") or []
    if isinstance(subtitles, list):
        for item in subtitles:
            if isinstance(item, dict):
                url = _first_url(item.get("subtitle_url") or item.get("url"))
                if url:
                    return url
    return ""


def _extract_cover_url(video: dict) -> str:
    for key in ("origin_cover", "cover", "dynamic_cover", "gaussian_cover"):
        url = _first_url(video.get(key))
        if url:
            return url
    return ""


def _extract_audio_track(aweme: dict, video: dict) -> dict:
    music = aweme.get("music") if isinstance(aweme.get("music"), dict) else {}
    play_url = music.get("play_url") if isinstance(music.get("play_url"), dict) else {}
    audio_track = {
        "musicId": str(music.get("id_str") or music.get("mid") or music.get("id") or ""),
        "title": music.get("title") or "",
        "author": music.get("author") or music.get("owner_nickname") or "",
        "duration": music.get("duration") or music.get("video_duration") or 0,
        "playUrl": _first_url(play_url),
        "isOriginal": bool(music.get("is_original")),
        "sourcePlatform": music.get("source_platform") or "",
        "hasMusicMeta": bool(music),
        "hasAudioBitrate": bool(video.get("bit_rate_audio")),
    }
    title = str(audio_track["title"])
    audio_track["speechHint"] = "original_voice" if "原声" in title or audio_track["isOriginal"] else "music_or_unknown"
    return audio_track


def fetch_aweme_detail(aweme_id: str, trace_id: str = "") -> dict:
    api_url = f"https://www.douyin.com/aweme/v1/aweme/detail/?aweme_id={aweme_id}"
    cookie_pool.ensure_ready()
    if cookie_pool.all_cookies and not cookie_pool.valid_cookies:
        cookie_pool.reset()
        logger.info("douyin cookie pool reset before request", {"traceId": trace_id, "total": len(cookie_pool.all_cookies)})
    attempts = max(1, len(cookie_pool.valid_cookies))
    last_error = ""
    for _ in range(attempts):
        cookie = cookie_pool.get_random_cookie()
        try:
            response = requests.get(api_url, headers=douyin_headers(cookie), timeout=settings.request_timeout)
            content_type = response.headers.get("Content-Type", "")
            if "json" not in content_type.lower():
                body_preview = response.text[:200].replace("\n", " ")
                last_error = f"抖音详情接口返回非 JSON，HTTP {response.status_code}，Content-Type={content_type}"
                logger.warning("douyin aweme detail non-json response", {
                    "traceId": trace_id,
                    "awemeId": aweme_id,
                    "statusCode": response.status_code,
                    "contentType": content_type,
                    "bodyPreview": body_preview,
                })
                continue
            try:
                data = response.json()
            except JSONDecodeError as error:
                body_preview = response.text[:200].replace("\n", " ")
                last_error = f"抖音详情接口 JSON 解析失败，HTTP {response.status_code}，Content-Type={content_type}"
                logger.warning("douyin aweme detail json decode failed", {
                    "traceId": trace_id,
                    "awemeId": aweme_id,
                    "statusCode": response.status_code,
                    "contentType": content_type,
                    "bodyPreview": body_preview,
                    "error": str(error),
                })
                continue
            if data.get("status_code") != 0 or not data.get("aweme_detail"):
                last_error = f"抖音详情接口 status_code={data.get('status_code')}，缺少 aweme_detail"
                cookie_pool.mark_invalid(cookie, reason=last_error)
                continue
            logger.info("douyin aweme detail fetched", {"traceId": trace_id, "awemeId": aweme_id})
            return data["aweme_detail"]
        except Exception as error:
            last_error = str(error)
            logger.warning("douyin aweme detail request failed", {"traceId": trace_id, "awemeId": aweme_id, "error": last_error})
            continue
    if not cookie_pool.all_cookies:
        raise VideoUnavailableError("无法解析：无可用抖音账号 Cookie，请补充账号")
    raise VideoUnavailableError(f"无法解析：抖音详情接口请求失败，Cookie 已配置但未拿到有效 JSON。{last_error}")


def fetch_subtitle_text(subtitle_url: str, trace_id: str = "") -> tuple[str, str]:
    if not subtitle_url:
        return "", "无官方字幕"
    try:
        response = requests.get(subtitle_url, timeout=settings.request_timeout)
        text = response.text
        try:
            data = response.json()
            candidates = data.get("subtitle") or data.get("utterances") or data.get("sentences") or []
            if isinstance(candidates, list):
                joined = " ".join(str(item.get("text") or item.get("words") or "").strip() for item in candidates if isinstance(item, dict)).strip()
                if joined:
                    return joined, ""
        except Exception:
            pass
        return text[:20000], ""
    except Exception as error:
        logger.warning("douyin subtitle fetch failed", {"traceId": trace_id, "subtitleUrl": subtitle_url, "error": str(error)})
        return "", f"字幕解析失败：{error}"


def transcribe_audio_track(audio_track: dict, workspace_dir: str, trace_id: str = "") -> Transcription:
    play_url = str(audio_track.get("playUrl") or "")
    if not play_url:
        return Transcription(text="", error="无可用音频轨")
    try:
        transcription = media_tools.transcribe_audio_url(play_url, workspace_dir)
        logger.info("douyin audio track transcription completed", {
            "traceId": trace_id,
            "textChars": len(transcription.text or ""),
            "segmentCount": len(transcription.segments),
            "error": transcription.error,
        })
        return transcription
    except Exception as error:
        logger.warning("douyin audio track transcription failed", {"traceId": trace_id, "error": str(error)})
        return Transcription(text="", error=f"音频轨转写失败：{error}")


def save_douyin_material(workspace_dir: str, material: dict):
    os.makedirs(workspace_dir, exist_ok=True)
    with open(os.path.join(workspace_dir, "douyin_material.json"), "w", encoding="utf-8") as file:
        json.dump(material, file, ensure_ascii=False, indent=2)


def inspect_douyin_url(url: str, trace_id: str = "") -> VideoInspection:
    workspace_dir = stable_video_workspace(url)
    cached_path = os.path.join(workspace_dir, "douyin_material.json")
    if os.path.exists(cached_path):
        with open(cached_path, "r", encoding="utf-8") as file:
            material = json.load(file)
        if material.get("cacheVersion") == DOUYIN_MATERIAL_CACHE_VERSION:
            logger.info("douyin material cache hit", {"traceId": trace_id, "workspaceDir": workspace_dir})
        else:
            material = {}
            logger.info("douyin material cache ignored", {"traceId": trace_id, "workspaceDir": workspace_dir})
    else:
        material = {}
    if not material:
        aweme_id = extract_aweme_id(url, trace_id=trace_id)
        aweme = fetch_aweme_detail(aweme_id, trace_id=trace_id)
        video = aweme.get("video") if isinstance(aweme.get("video"), dict) else {}
        cover_url = _extract_cover_url(video)
        keyframe_urls = _extract_keyframe_urls(video)
        subtitle_url = _extract_subtitle_url(video, aweme)
        subtitle_text, subtitle_error = fetch_subtitle_text(subtitle_url, trace_id=trace_id)
        audio_track = _extract_audio_track(aweme, video)
        audio_transcription = Transcription(text="", error="")
        if not subtitle_text and audio_track.get("playUrl"):
            audio_transcription = transcribe_audio_track(audio_track, workspace_dir, trace_id=trace_id)
        material = {
            "cacheVersion": DOUYIN_MATERIAL_CACHE_VERSION,
            "awemeId": aweme_id,
            "title": aweme.get("desc") or "",
            "description": aweme.get("desc") or "",
            "uploader": (aweme.get("author") or {}).get("nickname", "") if isinstance(aweme.get("author"), dict) else "",
            "coverUrl": cover_url,
            "keyframeUrls": keyframe_urls,
            "subtitleUrl": subtitle_url,
            "subtitleText": subtitle_text or audio_transcription.text,
            "subtitleError": subtitle_error if subtitle_text else audio_transcription.error,
            "transcriptionSource": "official_subtitle" if subtitle_text else ("audio_track_asr" if audio_transcription.text else "none"),
            "transcriptionSegments": [
                {"start": segment.start, "end": segment.end, "text": segment.text}
                for segment in audio_transcription.segments
            ],
            "audioTrack": audio_track,
            "duration": (video.get("duration") or 0) / 1000 if isinstance(video.get("duration"), (int, float)) else 0,
            "width": video.get("width") or 0,
            "height": video.get("height") or 0,
        }
        save_douyin_material(workspace_dir, material)
        logger.info("douyin material fetched", {
            "traceId": trace_id,
            "workspaceDir": workspace_dir,
            "awemeId": aweme_id,
            "keyframeCount": len(keyframe_urls),
            "hasSubtitle": bool(subtitle_text),
            "hasAudioTranscription": bool(audio_transcription.text),
            "hasAudioTrack": bool(audio_track.get("playUrl")),
        })
    image_urls = [material.get("coverUrl", ""), *material.get("keyframeUrls", [])]
    frames = [
        Keyframe(index=index, time=index * 3, mimeType="image/url", dataUri=image_url)
        for index, image_url in enumerate(image_urls[:9])
        if image_url
    ]
    return VideoInspection(
        ok=True,
        sourceUrl=url,
        videoInfo=VideoInfo(
            title=material.get("title") or "抖音视频",
            description=material.get("description") or "",
            uploader=material.get("uploader") or "",
            webpageUrl=url,
            tags=[],
            duration=float(material.get("duration") or 0),
            width=int(material.get("width") or 0),
            height=int(material.get("height") or 0),
            fileSize=0,
            mimeType="application/douyin-metadata",
            hasAudio=bool(material.get("subtitleText")),
            coverUrl=material.get("coverUrl") or "",
            subtitleUrl=material.get("subtitleUrl") or "",
            parser="douyin_lightweight",
        ),
        frames=frames,
        transcription=Transcription(
            text=material.get("subtitleText") or "",
            segments=[
                TranscriptSegment(
                    start=float(segment.get("start") or 0),
                    end=float(segment.get("end") or 0),
                    text=str(segment.get("text") or ""),
                )
                for segment in material.get("transcriptionSegments", [])
                if isinstance(segment, dict)
            ],
            error=material.get("subtitleError") or "",
        ),
        diagnostics={
            "parser": "douyin_lightweight",
            "workspaceDir": workspace_dir,
            "downloadedFullVideo": False,
            "cookiePool": cookie_pool.stats(),
            "frameCount": len(frames),
            "audioTrack": material.get("audioTrack") or {},
        },
    )

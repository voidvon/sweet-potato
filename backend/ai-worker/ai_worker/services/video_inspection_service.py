import time

from ai_worker.domain.video_inspection import VideoInspection
from ai_worker.infra import douyin_tools
from ai_worker.infra import media_tools
from ai_worker.infra import logger


class VideoInspectionService:
    def inspect_url(self, url: str, trace_id: str = "") -> VideoInspection:
        started = time.time()
        logger.info("video inspection started", {"traceId": trace_id, "url": url})
        if douyin_tools.is_douyin_url(url):
            result = douyin_tools.inspect_douyin_url(url, trace_id=trace_id)
            result.diagnostics["elapsedSeconds"] = round(time.time() - started, 2)
            logger.info("douyin lightweight inspection completed", {
                "traceId": trace_id,
                "elapsedSeconds": result.diagnostics["elapsedSeconds"],
                "title": result.videoInfo.title,
                "frames": len(result.frames),
                "subtitleChars": len(result.transcription.text or ""),
                "workspaceDir": result.diagnostics.get("workspaceDir"),
            })
            return result
        workspace_dir = media_tools.stable_video_workspace(url)
        logger.info("video workspace resolved", {"traceId": trace_id, "url": url, "workspaceDir": workspace_dir})
        logger.info("video download started", {"traceId": trace_id, "url": url, "workspaceDir": workspace_dir})
        video_path, raw_info = media_tools.download_video(url, workspace_dir)
        logger.info("video download completed", {"traceId": trace_id, "videoPath": video_path})
        metadata = media_tools.probe_video(video_path)
        logger.info("video probe completed", {"traceId": trace_id, "metadata": metadata})
        frames = media_tools.extract_keyframes(video_path, workspace_dir)
        logger.info("keyframe extraction completed", {"traceId": trace_id, "frameCount": len(frames)})
        transcription = media_tools.extract_transcription(video_path, workspace_dir)
        logger.info("audio transcription completed", {
            "traceId": trace_id,
            "textChars": len(transcription.text or ""),
            "segmentCount": len(transcription.segments),
            "error": transcription.error,
        })
        result = VideoInspection(
            ok=True,
            sourceUrl=url,
            videoInfo=media_tools.build_video_info(video_path, url, raw_info, metadata),
            frames=frames,
            transcription=transcription,
            diagnostics={
                "elapsedSeconds": round(time.time() - started, 2),
                "frameCount": len(frames),
                "workspaceDir": workspace_dir,
                "videoPath": video_path,
                "tools": {
                    "ytDlp": media_tools.has_command("yt-dlp"),
                    "ffmpeg": media_tools.has_command("ffmpeg"),
                    "ffprobe": media_tools.has_command("ffprobe"),
                },
            },
        )
        logger.info("video inspection completed", {
            "traceId": trace_id,
            "elapsedSeconds": result.diagnostics["elapsedSeconds"],
            "title": result.videoInfo.title,
            "duration": result.videoInfo.duration,
            "frames": len(result.frames),
            "workspaceDir": workspace_dir,
        })
        return result

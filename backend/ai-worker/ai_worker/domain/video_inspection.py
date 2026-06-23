from dataclasses import asdict, dataclass, field
from typing import Any


@dataclass
class VideoInfo:
    title: str
    description: str
    uploader: str
    webpageUrl: str
    tags: list[str]
    duration: float
    width: int
    height: int
    fileSize: int
    mimeType: str
    hasAudio: bool
    coverUrl: str = ""
    subtitleUrl: str = ""
    parser: str = ""


@dataclass
class Keyframe:
    index: int
    time: float
    mimeType: str
    dataUri: str


@dataclass
class TranscriptSegment:
    start: float
    end: float
    text: str


@dataclass
class Transcription:
    text: str
    segments: list[TranscriptSegment] = field(default_factory=list)
    error: str = ""


@dataclass
class VideoInspection:
    ok: bool
    sourceUrl: str
    videoInfo: VideoInfo
    frames: list[Keyframe]
    transcription: Transcription
    diagnostics: dict[str, Any]

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

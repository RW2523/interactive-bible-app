"""YouTube ingest: read a public video's details and its caption track with yt-dlp — no video is downloaded.

The video keeps living on YouTube: only its transcript (and the metadata shown in the library) is stored locally, and
playback happens in YouTube's own embedded player, limited to the clip that discusses a verse (``rights_status``
``embed_only``, so physical clip export stays disabled).

Caption tracks come from the video itself: a human-made track when there is one, otherwise the auto-generated one in the
video's language. When a video has no captions at all the pipeline falls back to Gemini transcription of the YouTube URL
(``ingest.transcribe.transcribe_youtube``).

``_extract`` and ``_download_track`` are module-level hooks so tests can run without network access.
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from typing import Any, Callable

import httpx

from .transcribe import youtube_id
from .validate import UploadRejected

log = logging.getLogger(__name__)

CAPTION_EXT = "json3"  # exact cue timings, unlike vtt rounding
PREFERRED_LANGUAGES = ("en", "en-US", "en-GB")
MAX_CAPTION_BYTES = 8 * 1024 * 1024
TRACK_TIMEOUT = 30.0


@dataclass(frozen=True)
class CaptionTrack:
    language: str
    kind: str  # "manual" | "auto"
    name: str
    url: str

    def public(self) -> dict[str, Any]:
        return {"language": self.language, "kind": self.kind, "name": self.name}


@dataclass
class VideoInfo:
    video_id: str
    url: str
    title: str
    channel: str | None = None
    duration_ms: int | None = None
    thumbnail: str | None = None
    upload_date: str | None = None  # YYYYMMDD as YouTube reports it
    language: str | None = None
    description: str | None = None
    chapters: list[dict[str, Any]] = field(default_factory=list)
    tracks: list[CaptionTrack] = field(default_factory=list)

    @property
    def watch_url(self) -> str:
        return f"https://www.youtube.com/watch?v={self.video_id}"

    @property
    def embed_url(self) -> str:
        return f"https://www.youtube-nocookie.com/embed/{self.video_id}"

    def best_track(self, language: str | None = None) -> CaptionTrack | None:
        """A human-made track in the wanted language first, then the video's own auto-generated captions."""
        wanted = [language, self.language, *PREFERRED_LANGUAGES]
        prefixes = [w.split("-")[0].lower() for w in wanted if w]
        for kind in ("manual", "auto"):
            for prefix in prefixes:
                for track in self.tracks:
                    if track.kind == kind and track.language.split("-")[0].lower() == prefix:
                        return track
            for track in self.tracks:  # any track of this kind (a video in another language)
                if track.kind == kind:
                    return track
        return None

    def public(self, language: str | None = None) -> dict[str, Any]:
        best = self.best_track(language)
        return {
            "provider": "youtube",
            "video_id": self.video_id,
            "title": self.title,
            "channel": self.channel,
            "duration_ms": self.duration_ms,
            "thumbnail": self.thumbnail,
            "upload_date": self.upload_date,
            "language": self.language,
            "watch_url": self.watch_url,
            "embed_url": self.embed_url,
            "chapters": self.chapters[:60],
            "captions": {"tracks": [t.public() for t in self.tracks], "best": best.public() if best else None},
        }


# ------------------------------------------------------------------------------------------- yt-dlp hooks
def _extract(url: str) -> dict[str, Any]:
    """Video details and caption track URLs (never downloads media)."""
    import yt_dlp

    options = {
        "skip_download": True,
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "socket_timeout": 20,
        "retries": 2,
        "extractor_args": {"youtube": {"player_skip": ["configs"]}},
    }
    with yt_dlp.YoutubeDL(options) as ydl:
        return ydl.extract_info(url, download=False) or {}


def _download_track(url: str) -> str:
    with httpx.Client(timeout=TRACK_TIMEOUT, follow_redirects=True, headers={"User-Agent": "InteractiveBibleApp/1.0"}) as client:
        with client.stream("GET", url) as resp:
            if resp.status_code != 200:
                raise UploadRejected(f"could not download the captions from YouTube ({resp.status_code})")
            chunks: list[bytes] = []
            size = 0
            for chunk in resp.iter_bytes():
                size += len(chunk)
                if size > MAX_CAPTION_BYTES:
                    raise UploadRejected("the caption file is unexpectedly large")
                chunks.append(chunk)
    return b"".join(chunks).decode("utf-8", errors="replace")


extractor: Callable[[str], dict[str, Any]] = _extract
track_downloader: Callable[[str], str] = _download_track


# ------------------------------------------------------------------------------------------- inspect
def _friendly_error(message: str) -> str:
    text = message.lower()
    if "private" in text:
        return "That video is private. Ask the owner to make it public or unlisted."
    if "members-only" in text or "join this channel" in text:
        return "That video is for channel members only, so its transcript can't be read."
    if "age" in text and "confirm" in text:
        return "That video is age-restricted and can't be read without signing in to YouTube."
    if "unavailable" in text or "removed" in text or "does not exist" in text:
        return "That video is unavailable — check the link."
    if "sign in" in text or "bot" in text:
        return "YouTube refused the request. Try again in a few minutes."
    if "live" in text and "not started" in text:
        return "That stream hasn't started yet."
    return f"Could not read that YouTube video ({message.strip()[:160]})."


def _tracks_from(info: dict[str, Any]) -> list[CaptionTrack]:
    tracks: list[CaptionTrack] = []
    for kind, key in (("manual", "subtitles"), ("auto", "automatic_captions")):
        available = info.get(key) or {}
        for language, formats in available.items():
            if kind == "auto" and not _is_original_language(language, info):
                continue  # skip YouTube's machine translations into other languages
            entry = next((f for f in formats if f.get("ext") == CAPTION_EXT and f.get("url")), None)
            if not entry:
                continue
            name = entry.get("name") or ("Auto-generated" if kind == "auto" else language)
            tracks.append(CaptionTrack(language=language, kind=kind, name=str(name)[:60], url=entry["url"]))
    return tracks


def _is_original_language(language: str, info: dict[str, Any]) -> bool:
    """YouTube lists auto-translations for hundreds of languages; keep the spoken one (and English as a fallback)."""
    if language.endswith("-orig"):
        return True
    base = language.split("-")[0].lower()
    video_language = (info.get("language") or "").split("-")[0].lower()
    if video_language:
        return base == video_language
    return base == "en"


PLACEHOLDER_CHAPTER = re.compile(r"^<?untitled chapter\s*\d*>?$", re.I)


def _chapter_title(title: Any) -> str:
    """YouTube stores "<Untitled Chapter 1>" for unnamed chapters: show nothing rather than that."""
    text = str(title or "").strip()
    return "" if PLACEHOLDER_CHAPTER.match(text) else text[:120]


def _thumbnail(info: dict[str, Any], video_id: str) -> str:
    """A still that always loads: yt-dlp's best pick is often a .webp or a maxresdefault that 404s for some videos."""
    chosen = str(info.get("thumbnail") or "")
    if chosen.endswith(".jpg") and "maxresdefault" not in chosen:
        return chosen
    jpgs = [t for t in (info.get("thumbnails") or []) if isinstance(t, dict) and str(t.get("url") or "").endswith(".jpg")
            and "maxresdefault" not in str(t.get("url")) and (t.get("width") or 0) >= 480]
    if jpgs:
        return str(sorted(jpgs, key=lambda t: t.get("width") or 0)[-1]["url"])
    return f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg"


def inspect(url: str) -> VideoInfo:
    """Details + caption tracks for a public YouTube URL. Raises UploadRejected with a readable message."""
    video_id = youtube_id(url)
    if not video_id:
        raise UploadRejected("that doesn't look like a YouTube link (expected youtube.com/watch?v=… or youtu.be/…)")
    try:
        info = extractor(f"https://www.youtube.com/watch?v={video_id}")
    except UploadRejected:
        raise
    except Exception as exc:  # yt_dlp.utils.DownloadError and friends
        raise UploadRejected(_friendly_error(str(exc))) from exc
    if not info:
        raise UploadRejected("Could not read that YouTube video — check the link.")
    if info.get("is_live"):
        raise UploadRejected("That video is live right now. Add it once the recording is published.")
    duration = info.get("duration")
    chapters = [{"title": _chapter_title(c.get("title")), "start_ms": int(float(c.get("start_time") or 0) * 1000),
                 "end_ms": int(float(c["end_time"]) * 1000) if c.get("end_time") is not None else None}
                for c in (info.get("chapters") or []) if isinstance(c, dict)]
    return VideoInfo(
        video_id=video_id,
        url=f"https://www.youtube.com/watch?v={video_id}",
        title=(info.get("title") or f"YouTube video {video_id}").strip()[:300],
        channel=(info.get("uploader") or info.get("channel") or None),
        duration_ms=int(float(duration) * 1000) if duration else None,
        thumbnail=_thumbnail(info, video_id),
        upload_date=info.get("upload_date"),
        language=info.get("language"),
        description=(info.get("description") or None),
        chapters=chapters,
        tracks=_tracks_from(info),
    )


# ------------------------------------------------------------------------------------------- captions
def parse_json3(text: str) -> list[dict[str, Any]]:
    """YouTube's json3 caption format -> cues [{start_ms, end_ms, text}] (the shape ingest.captions uses)."""
    import json

    try:
        data = json.loads(text)
    except ValueError as exc:
        raise UploadRejected("YouTube returned captions in an unexpected format") from exc
    cues: list[dict[str, Any]] = []
    for event in data.get("events") or []:
        segments = event.get("segs") or []
        body = "".join(str(s.get("utf8") or "") for s in segments).replace("\n", " ").strip()
        if not body or body == "​":
            continue
        start = int(event.get("tStartMs") or 0)
        duration = event.get("dDurationMs")
        end = start + int(duration) if duration else start + 2000
        if cues and start < cues[-1]["end_ms"]:  # auto-captions overlap while words roll in
            cues[-1]["end_ms"] = min(cues[-1]["end_ms"], start)
        cues.append({"start_ms": start, "end_ms": max(end, start + 200), "text": body, "speaker": None})
    return [c for c in cues if c["end_ms"] > c["start_ms"]]


def caption_cues(info: VideoInfo, language: str | None = None) -> tuple[list[dict[str, Any]], CaptionTrack]:
    """Cues of the best caption track. Raises UploadRejected when the video has none."""
    track = info.best_track(language)
    if track is None:
        raise UploadRejected("That video has no captions on YouTube.")
    cues = parse_json3(track_downloader(track.url))
    if not cues:
        raise UploadRejected("YouTube returned an empty caption track for that video.")
    log.info("youtube captions: %s cues (%s, %s)", len(cues), track.language, track.kind)
    return cues, track

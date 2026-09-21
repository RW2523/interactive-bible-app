"""Speech-to-text with timestamps via Gemini (P-00), chunked locally with ffmpeg for timing accuracy.

Chunks are cut at silences near TRANSCRIBE_CHUNK_SECONDS, transcribed independently (cached per
chunk hash, so a retry never re-transcribes finished chunks), validated and repaired, then offset
back onto the source timeline.
"""
from __future__ import annotations

import hashlib
import logging
import re
from pathlib import Path
from typing import Any

from ..ai.llm import AIInvalidOutput, AIUnavailable, audio_part, get_llm
from ..ai.schemas import TranscriptOut
from ..config import get_settings
from . import media
from .units import Unit, split_sentences_with_times

log = logging.getLogger(__name__)
TRANSCRIBER_VERSION = "gemini-chunked-1"


def _repair(utterances: list[dict[str, Any]], clip_s: float, regions: list[tuple[float, float]]) -> tuple[list[dict[str, Any]], list[str]]:
    notes: list[str] = []
    items = [u for u in utterances if u["text"].strip()]
    if not items:
        return [], ["empty"]
    items.sort(key=lambda u: (u["start"], u["end"]))
    over = sum(1 for u in items if u["start"] > clip_s + 2 or u["end"] > clip_s + 5)
    zero = sum(1 for u in items if u["end"] <= u["start"])
    span = max(u["end"] for u in items) - min(u["start"] for u in items)
    degenerate = over > len(items) * 0.2 or zero > len(items) * 0.5 or (clip_s > 60 and span < clip_s * 0.35)
    if degenerate:
        # proportional allocation of words over detected speech regions
        notes.append("timestamps_reallocated")
        words = [max(1, len(u["text"].split())) for u in items]
        total_words = sum(words)
        speech = regions or [(0.0, clip_s)]
        speech_total = sum(b - a for a, b in speech)

        def at(fraction: float) -> float:
            target = fraction * speech_total
            acc = 0.0
            for a, b in speech:
                if acc + (b - a) >= target:
                    return a + (target - acc)
                acc += b - a
            return speech[-1][1]

        cumulative = 0
        for u, w in zip(items, words):
            u["start"] = at(cumulative / total_words)
            cumulative += w
            u["end"] = at(cumulative / total_words)
        return items, notes
    prev_end = 0.0
    for u in items:
        u["start"] = min(max(0.0, u["start"]), clip_s)
        u["end"] = min(max(u["end"], u["start"]), clip_s)
        if u["start"] < prev_end - 0.05:
            u["start"] = min(prev_end, u["end"])
            notes.append("overlap_fixed")
        if u["end"] - u["start"] < 0.2:
            u["end"] = min(clip_s, u["start"] + max(0.4, 0.33 * len(u["text"].split())))
            notes.append("duration_padded")
        prev_end = u["end"]
    return items, sorted(set(notes))


YOUTUBE_RE = re.compile(r"(?:(?:youtube\.com|youtube-nocookie\.com)/(?:watch\?v=|embed/|shorts/|live/|v/)|youtu\.be/)([A-Za-z0-9_-]{11})")
MEDIA_EXTENSIONS = (".mp4", ".m4v", ".mov", ".webm", ".mp3", ".m4a", ".wav", ".aac", ".ogg", ".flac")


def youtube_id(url: str | None) -> str | None:
    m = YOUTUBE_RE.search(url or "")
    return m.group(1) if m else None


def download_media(url: str, dest_dir: Path, max_bytes: int) -> Path:
    """Fetch an approved, publicly hosted media file for local processing (SSRF-guarded, size-limited)."""
    import httpx

    from .validate import UploadRejected, validate_public_url

    validate_public_url(url)
    suffix = next((ext for ext in MEDIA_EXTENSIONS if url.lower().split("?")[0].endswith(ext)), "")
    dest = dest_dir / f"remote_{hashlib.sha256(url.encode()).hexdigest()[:16]}{suffix or '.bin'}"
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    size = 0
    with httpx.Client(timeout=httpx.Timeout(60.0, connect=15.0), follow_redirects=True, headers={"User-Agent": "InteractiveBibleApp/1.0"}) as client:
        with client.stream("GET", url) as resp:
            if resp.status_code != 200:
                raise UploadRejected(f"could not download media ({resp.status_code})")
            validate_public_url(str(resp.url))
            ctype = resp.headers.get("content-type", "")
            if not (ctype.startswith(("audio/", "video/")) or ctype in ("application/octet-stream", "binary/octet-stream") or suffix):
                raise UploadRejected(f"URL is not a media file ({ctype}); for web pages use captions or a YouTube link")
            with dest.open("wb") as out:
                for chunk in resp.iter_bytes(1 << 20):
                    size += len(chunk)
                    if size > max_bytes:
                        out.close()
                        dest.unlink(missing_ok=True)
                        raise UploadRejected("remote media exceeds the maximum allowed size")
                    out.write(chunk)
    return dest


def transcribe_youtube(url: str, duration_ms: int | None, resource_id: str, run_id: str, language: str, speaker_hint: str | None) -> tuple[list[Unit], dict[str, Any]]:
    """Transcribe a public YouTube video through Gemini's URL support, in offset windows for timestamp accuracy."""
    llm = get_llm()
    if not llm.available:
        raise AIUnavailable("YouTube transcription needs GEMINI_API_KEY (or upload captions for the video).")
    chunk_s = float(get_settings().transcribe_chunk_seconds)
    windows = [(None, None)] if not duration_ms else [(s, min(s + chunk_s, duration_ms / 1000)) for s in _frange(0.0, duration_ms / 1000, chunk_s)]
    units: list[Unit] = []
    diagnostics: dict[str, Any] = {"chunks": [], "source": "youtube", "duration_ms": duration_ms, "method_version": TRANSCRIBER_VERSION}
    for index, (start_s, end_s) in enumerate(windows):
        part: dict[str, Any] = {"fileData": {"fileUri": url}}
        if start_s is not None:
            part["videoMetadata"] = {"startOffset": f"{start_s:.0f}s", "endOffset": f"{end_s:.0f}s"}
        clip_s = (end_s - start_s) if start_s is not None else (duration_ms or 0) / 1000
        result = llm.run(
            "P-00",
            {"clip_duration_seconds": round(clip_s, 2) if clip_s else "unknown", "language": language or "auto", "speaker_hint": speaker_hint or "unknown"},
            TranscriptOut, media_parts=[part], resource_id=resource_id, run_id=run_id,
            generation_overrides={"mediaResolution": "MEDIA_RESOLUTION_LOW"},
        )
        utterances = [u.model_dump() for u in result.output.utterances]
        effective = clip_s or max((u["end"] for u in utterances), default=0.0)
        repaired, notes = _repair(utterances, effective, [])
        diagnostics["chunks"].append({"index": index, "start_s": start_s, "end_s": end_s, "utterances": len(repaired), "repairs": notes, "model": result.model, "cached": result.cached})
        base = int((start_s or 0) * 1000)
        for u in repaired:
            text = u["text"].strip()
            if not text or text.lower() in ("[music]", "[silence]", "[inaudible]"):
                continue
            for sentence, st, en in split_sentences_with_times(text, base + int(u["start"] * 1000), base + int(u["end"] * 1000)):
                if sentence.strip():
                    units.append(Unit(id="", kind="sentence", text_raw=sentence.strip(), start_ms=st, end_ms=en, speaker=speaker_hint or u.get("speaker")))
    if not duration_ms and units:
        diagnostics["duration_ms"] = max(u.end_ms or 0 for u in units)
    return units, diagnostics


def _frange(start: float, stop: float, step: float) -> list[float]:
    out = []
    x = start
    while x < stop - 1.0:
        out.append(x)
        x += step
    return out


def transcribe_media(source: Path, resource_id: str, run_id: str, language: str, speaker_hint: str | None, work: Path) -> tuple[list[Unit], dict[str, Any]]:
    llm = get_llm()
    if not llm.available:
        raise AIUnavailable("Transcription needs GEMINI_API_KEY (or upload a captions file and use transcript mode 'captions').")
    info = media.probe(source)
    if not info.has_audio:
        raise media.MediaError("media has no audio track to transcribe")
    audio = media.extract_audio(source, work / "audio_16k.mp3")
    duration_s = info.duration_ms / 1000
    silences = media.detect_silences(audio)
    chunks = media.plan_chunks(duration_s, silences, float(get_settings().transcribe_chunk_seconds))
    units: list[Unit] = []
    diagnostics: dict[str, Any] = {"chunks": [], "duration_ms": info.duration_ms, "method_version": TRANSCRIBER_VERSION}
    speakers_seen: set[str] = set()
    queue = [(s, e, 0) for s, e in chunks]
    index = -1
    while queue:
        start_s, end_s, depth = queue.pop(0)
        index += 1
        chunk_path = media.cut_audio(audio, start_s, end_s, work / f"chunk_{index:03d}.mp3")
        data = chunk_path.read_bytes()
        chunk_hash = hashlib.sha256(data).hexdigest()
        clip_s = end_s - start_s
        try:
            result = llm.run(
                "P-00",
                {"clip_duration_seconds": round(clip_s, 2), "language": language or "auto", "speaker_hint": speaker_hint or "unknown"},
                TranscriptOut, media_parts=[audio_part(data, "audio/mp3")], resource_id=resource_id, run_id=run_id,
                cache_salt=chunk_hash,
            )
        except AIInvalidOutput:
            # usually a transcript truncated by the output token limit: split the chunk at its nearest silence and retry
            if depth >= 2 or clip_s < 40:
                raise
            mid = (start_s + end_s) / 2
            quiet = [((a + b) / 2) for a, b in silences if start_s + 10 < (a + b) / 2 < end_s - 10]
            cut = min(quiet, key=lambda x: abs(x - mid)) if quiet else mid
            queue[:0] = [(start_s, cut, depth + 1), (cut, end_s, depth + 1)]
            diagnostics.setdefault("split_chunks", []).append([round(start_s, 2), round(end_s, 2)])
            continue
        regions = [(max(0.0, a - start_s), min(clip_s, b - start_s)) for a, b in media.speech_regions(duration_s, silences) if b > start_s and a < end_s]
        utterances = [u.model_dump() for u in result.output.utterances]
        repaired, notes = _repair(utterances, clip_s, regions)
        diagnostics["chunks"].append({"index": index, "start_s": round(start_s, 3), "end_s": round(end_s, 3), "utterances": len(repaired), "repairs": notes, "model": result.model, "cached": result.cached})
        for u in repaired:
            text = u["text"].strip()
            if text.lower() in ("[music]", "[silence]", "[inaudible]"):
                continue
            speaker = u.get("speaker") or None
            if speaker:
                speakers_seen.add(speaker)
            base = int(start_s * 1000)
            for sentence, st, en in split_sentences_with_times(text, base + int(u["start"] * 1000), base + int(u["end"] * 1000)):
                if sentence.strip():
                    units.append(Unit(id="", kind="sentence", text_raw=sentence.strip(), start_ms=st, end_ms=en, speaker=speaker))
    if speaker_hint and len(speakers_seen) <= 1:
        for u in units:
            u.speaker = speaker_hint
    diagnostics["speakers"] = sorted(speakers_seen)
    diagnostics["media_start_offset_ms"] = info.start_offset_ms
    return units, diagnostics

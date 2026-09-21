"""Local MP4 export of an AI story (``export_story_video`` job): scene stills + narration -> H.264/AAC with ffmpeg.

Port of the original storyVideoExport.js: scene durations are weighted by each scene's ``durationSec`` and scaled to
the narration length, with crossfades between scenes. A story without narration gets a silent audio track and uses
the scene durations; a scene without an image gets a placeholder frame drawn locally (no AI). The MP4 is cached per
story generation, so exporting the same story again is instant.
"""
from __future__ import annotations

import logging
import os
import shutil
import struct
import zlib
from pathlib import Path
from typing import Any

import numpy as np
from sqlalchemy.orm import Session

from ... import jobs, storage
from ...db import session_scope
from ...ids import new_id
from ...ingest import media
from ...security import Viewer
from ..bible import NotFound
from . import data, stories
from .common import storage_segment

log = logging.getLogger(__name__)

# module-level so tests (and small machines) can render tiny videos quickly
VIDEO_SIZES = {"landscape": (1920, 1080), "portrait": (1080, 1920)}
VIDEO_FPS = 30
VIDEO_PRESET = "medium"
VIDEO_CRF = 20
AUDIO_BITRATE = "192k"
RENDER_TIMEOUT_SECONDS = 1800

NAVY_DEEP, NAVY, PARCHMENT, GOLD, INK, AMBER = (9, 17, 36), (27, 45, 84), (246, 238, 219), (201, 162, 39), (20, 33, 61), (226, 168, 92)


# ---------------------------------------------------------------------------------------------- request
def request_export(session: Session, viewer: Viewer, event_id: str, image_format: str = "landscape") -> dict[str, Any]:
    data.get_event(event_id)
    fmt = stories.story_format(image_format)
    row = stories.story_row(session, event_id, fmt)
    if not row:
        raise NotFound("no story has been generated for this event yet")
    gen_id = (row["manifest"] or {}).get("genId") or "current"
    # one job per requester: job status and downloads are visible to the requester only (the MP4 itself is cached per generation)
    job_id = jobs.enqueue(session, "export_story_video", {
        "event_id": event_id, "image_format": fmt, "generation_id": gen_id, "requested_by": viewer.user_id,
    }, dedupe_key=f"story-video:{event_id}:{fmt}:{gen_id}:{viewer.user_id}", max_attempts=1)  # rendering is deterministic: no blind retries
    return {"job_id": job_id, "status": "queued"}


# ---------------------------------------------------------------------------------------------- job
def export_story_video(payload: dict[str, Any]) -> dict[str, Any]:
    event = data.get_event(payload["event_id"])
    event_id = storage_segment(event["id"])
    fmt = stories.story_format(payload.get("image_format", "landscape"))
    with session_scope() as s:
        row = stories.story_row(s, event_id, fmt)
    if not row:
        raise NotFound("the story no longer exists; generate it again")
    manifest = row["manifest"] or {}
    gen_id = storage_segment(manifest.get("genId"))
    key = stories.video_key(event_id, fmt, gen_id)
    jobs.report_progress("render", 0, 1, "Rendering the video")
    if not storage.exists(key):
        render_story_video(manifest, fmt, storage.path_for(key))
    info = media.probe(storage.path_for(key))
    jobs.report_progress("render", 1, 1, "Video ready")
    return {"storage_key": key, "filename": f"{event_id}-story.mp4", "duration_seconds": round(info.duration_ms / 1000, 2),
            "event_id": event_id, "image_format": fmt, "generation_id": gen_id, "url": storage.signed_url(key)}


def render_story_video(manifest: dict[str, Any], image_format: str, dest: Path) -> Path:
    if not (shutil.which("ffmpeg") and shutil.which("ffprobe")):
        raise media.MediaError("ffmpeg is not installed (brew install ffmpeg)")
    scenes = [s for s in manifest.get("scenes") or [] if isinstance(s, dict)]
    if not scenes:
        raise ValueError("the story has no scenes")
    width, height = VIDEO_SIZES[image_format]
    work = storage.work_dir(f"story-video-{new_id('render')}")
    try:
        frames = []
        for number, scene in enumerate(scenes, start=1):
            key = scene.get("imageKey")
            if isinstance(key, str) and storage.exists(key):
                frames.append(storage.path_for(key))
            else:
                frames.append(placeholder_frame(scene.get("title") or manifest.get("title") or "", f"Scene {number}", (width, height),
                                                work / f"placeholder-{number}.png"))
        weights = [max(0.5, float(scene.get("durationSec") or 6)) for scene in scenes]
        audio, audio_seconds = _narration(manifest)
        total = audio_seconds if audio else sum(weights)
        durations, xfade = plan_scene_durations(weights, total)

        args = ["ffmpeg", "-y", "-v", "error"]
        for frame, seconds in zip(frames, durations, strict=True):
            args += ["-loop", "1", "-t", f"{seconds:.4f}", "-i", str(frame)]
        if audio:
            args += ["-i", str(audio)]
        else:
            args += ["-f", "lavfi", "-t", f"{total:.4f}", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100"]
        dest.parent.mkdir(parents=True, exist_ok=True)
        partial = dest.with_name(f"{dest.name}.{new_id('part')}.part")
        args += ["-filter_complex", build_filter_graph(durations, width, height, VIDEO_FPS, xfade), "-map", "[outv]", "-map", f"{len(frames)}:a",
                 "-c:v", "libx264", "-preset", VIDEO_PRESET, "-crf", str(VIDEO_CRF), "-pix_fmt", "yuv420p",
                 "-c:a", "aac", "-b:a", AUDIO_BITRATE, "-shortest", "-movflags", "+faststart", "-f", "mp4", str(partial)]
        try:
            media.run_tool(args, timeout=RENDER_TIMEOUT_SECONDS)
            os.replace(partial, dest)
        finally:
            partial.unlink(missing_ok=True)
        return dest
    finally:
        shutil.rmtree(work, ignore_errors=True)


def _narration(manifest: dict[str, Any]) -> tuple[Path | None, float]:
    """(narration file, seconds), or (None, 0) when the story has no usable narration (the video gets a silent track)."""
    key = manifest.get("audioKey")
    if not (isinstance(key, str) and storage.exists(key)):
        return None, 0.0
    path = storage.path_for(key)
    try:
        seconds = media.probe(path).duration_ms / 1000
    except media.MediaError as exc:
        log.warning("story narration %s is unreadable, exporting with a silent track: %s", key, exc)
        return None, 0.0
    if seconds <= 0.2:
        log.warning("story narration %s is too short to time the video (%.2fs), exporting with a silent track", key, seconds)
        return None, 0.0
    return path, seconds


# ---------------------------------------------------------------------------------------------- timing + filter graph
def plan_scene_durations(weights: list[float], total_seconds: float) -> tuple[list[float], float]:
    """Per-scene clip lengths and the crossfade length so that the finished video lasts ``total_seconds``.

    Each clip overlaps the next by ``xfade``, so the clips add up to total + (n - 1) * xfade; the crossfade shrinks
    until every clip is comfortably longer than it (same algorithm as the original JavaScript exporter).
    """
    n = len(weights)
    weight_sum = sum(weights)
    xfade = min(0.55, max(0.12, total_seconds / (8 * max(n, 2))))
    min_visible = 0.35
    durations: list[float] = []
    for _ in range(12):
        target = total_seconds + (n - 1) * xfade
        durations = [w / weight_sum * target for w in weights]
        shortest = min(durations)
        if shortest > xfade + min_visible:
            break
        xfade = max(0.08, shortest * 0.35)
    else:  # very short videos: keep the last crossfade, and time the clips with that same crossfade
        durations = [w / weight_sum * (total_seconds + (n - 1) * xfade) for w in weights]
    return durations, xfade


def build_filter_graph(durations: list[float], width: int, height: int, fps: int, xfade: float) -> str:
    parts = [
        f"[{i}:v]scale={width}:{height}:force_original_aspect_ratio=decrease:force_divisible_by=2,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,"
        f"setsar=1,format=yuv420p,settb=AVTB,fps={fps},trim=duration={seconds:.4f},setpts=PTS-STARTPTS[v{i}]"
        for i, seconds in enumerate(durations)
    ]
    if len(durations) == 1:
        return ";".join([*parts, "[v0]setpts=PTS-STARTPTS[outv]"])
    graph = ";".join(parts)
    previous, elapsed = "[v0]", durations[0]
    for i in range(1, len(durations)):
        label = "outv" if i == len(durations) - 1 else f"x{i}"
        graph += f";{previous}[v{i}]xfade=transition=fade:duration={xfade:.4f}:offset={elapsed - xfade:.4f}[{label}]"
        previous = f"[{label}]"
        elapsed += durations[i] - xfade
    return graph


# ---------------------------------------------------------------------------------------------- placeholder frames
def _gradient(width: int, height: int) -> np.ndarray:
    """Deep navy at the top to brand navy at the bottom, with a soft warm glow near the horizon."""
    t = np.linspace(0.0, 1.0, height, dtype=np.float32)[:, None]
    top, bottom = np.array(NAVY_DEEP, dtype=np.float32), np.array(NAVY, dtype=np.float32)
    rows = top * (1 - t) + bottom * t
    glow = np.exp(-((t - 0.8) ** 2) / 0.015) * 0.3
    rows = rows * (1 - glow) + np.array(AMBER, dtype=np.float32) * glow
    return np.repeat(rows[:, None, :], width, axis=1).clip(0, 255).astype(np.uint8)


def _png(pixels: np.ndarray) -> bytes:
    height, width, _ = pixels.shape
    raw = b"".join(b"\x00" + pixels[y].tobytes() for y in range(height))

    def chunk(tag: bytes, body: bytes) -> bytes:
        return struct.pack(">I", len(body)) + tag + body + struct.pack(">I", zlib.crc32(tag + body) & 0xFFFFFFFF)

    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw, 6)) + chunk(b"IEND", b"")


def placeholder_frame(title: str, subtitle: str, size: tuple[int, int], dest: Path) -> Path:
    """A branded still for a scene that has no illustration: navy gradient, parchment card, scene title."""
    width, height = size
    dest.parent.mkdir(parents=True, exist_ok=True)
    pixels = _gradient(width, height)
    try:
        from PIL import Image, ImageDraw, ImageFont
    except ImportError:  # Pillow missing: the gradient alone still makes a valid frame
        dest.write_bytes(_png(pixels))
        return dest

    image = Image.fromarray(pixels, "RGB")
    draw = ImageDraw.Draw(image)
    unit = min(width, height)
    title_font = ImageFont.load_default(size=max(8, unit // 13))  # scalable when Pillow has FreeType, a bitmap font otherwise
    sub_font = ImageFont.load_default(size=max(6, unit // 26))
    card_width = int(width * 0.8)
    padding = max(4, unit // 18)
    lines = _wrap(draw, " ".join((title or "").split()) or "Scene", title_font, card_width - 2 * padding, max_lines=3)
    line_height = int(getattr(title_font, "size", 10) * 1.25)
    sub_height = int(getattr(sub_font, "size", 10) * 1.3)
    rule_gap = max(2, unit // 60)
    card_height = 2 * padding + line_height * len(lines) + 2 * rule_gap + sub_height
    left, top = (width - card_width) // 2, (height - card_height) // 2
    draw.rounded_rectangle([left, top, left + card_width, top + card_height], radius=max(2, unit // 36), fill=PARCHMENT,
                           outline=GOLD, width=max(1, unit // 200))
    y = top + padding
    for line in lines:
        draw.text(((width - draw.textlength(line, font=title_font)) / 2, y), line, font=title_font, fill=INK)
        y += line_height
    y += rule_gap
    rule = max(8, card_width // 6)
    draw.line([((width - rule) / 2, y), ((width + rule) / 2, y)], fill=GOLD, width=max(1, unit // 270))
    draw.text(((width - draw.textlength(subtitle, font=sub_font)) / 2, y + rule_gap), subtitle, font=sub_font, fill=GOLD)
    image.save(dest, format="PNG")
    return dest


def _wrap(draw: Any, text: str, font: Any, max_width: int, max_lines: int) -> list[str]:
    lines: list[str] = []
    current = ""
    for word in text.split():
        candidate = f"{current} {word}".strip()
        if current and draw.textlength(candidate, font=font) > max_width:
            lines.append(current)
            current = word
        else:
            current = candidate
    if current:
        lines.append(current)
    if len(lines) > max_lines:
        lines = lines[:max_lines]
        last = lines[-1]
        while last and draw.textlength(last + "…", font=font) > max_width:
            last = last[:-1].rstrip()
        lines[-1] = last + "…"
    return lines

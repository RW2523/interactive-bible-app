"""Local media processing with ffmpeg/ffprobe (isolated subprocesses with timeouts and CPU limits)."""
from __future__ import annotations

import json
import os
import re
import resource
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path


class MediaError(RuntimeError):
    pass


def _limits() -> None:  # runs in the child process
    try:
        resource.setrlimit(resource.RLIMIT_CPU, (1800, 1800))
    except (ValueError, OSError):
        pass
    os.nice(5)


def run_tool(args: list[str], timeout: int = 900) -> subprocess.CompletedProcess:
    if not shutil.which(args[0]):
        raise MediaError(f"{args[0]} is not installed (brew install ffmpeg)")
    try:
        return subprocess.run(args, capture_output=True, timeout=timeout, check=True, preexec_fn=_limits)
    except subprocess.CalledProcessError as exc:
        raise MediaError(f"{args[0]} failed: {exc.stderr.decode(errors='replace')[-800:]}") from exc
    except subprocess.TimeoutExpired as exc:
        raise MediaError(f"{args[0]} timed out after {timeout}s") from exc


@dataclass
class ProbeInfo:
    duration_ms: int
    start_offset_ms: int
    has_audio: bool
    has_video: bool
    format_name: str
    width: int | None = None
    height: int | None = None


def probe(path: Path) -> ProbeInfo:
    out = run_tool(["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", str(path)], timeout=60)
    data = json.loads(out.stdout or b"{}")
    fmt = data.get("format", {})
    streams = data.get("streams", [])
    video = next((s for s in streams if s.get("codec_type") == "video" and s.get("disposition", {}).get("attached_pic") != 1), None)
    audio = next((s for s in streams if s.get("codec_type") == "audio"), None)
    duration = float(fmt.get("duration") or (audio or video or {}).get("duration") or 0)
    start = float(fmt.get("start_time") or 0)
    if duration <= 0:
        raise MediaError("could not determine media duration")
    return ProbeInfo(
        duration_ms=int(duration * 1000), start_offset_ms=int(max(0.0, start) * 1000), has_audio=audio is not None,
        has_video=video is not None, format_name=fmt.get("format_name", ""),
        width=(video or {}).get("width"), height=(video or {}).get("height"),
    )


def extract_audio(source: Path, dest: Path, sample_rate: int = 16000, bitrate: str = "32k") -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    run_tool(["ffmpeg", "-y", "-v", "error", "-i", str(source), "-map", "0:a:0", "-vn", "-ac", "1", "-ar", str(sample_rate), "-c:a", "libmp3lame", "-b:a", bitrate, str(dest)], timeout=1800)
    return dest


def detect_silences(audio: Path, noise_db: int = -35, min_seconds: float = 0.35) -> list[tuple[float, float]]:
    proc = run_tool(["ffmpeg", "-v", "info", "-i", str(audio), "-af", f"silencedetect=noise={noise_db}dB:d={min_seconds}", "-f", "null", "-"], timeout=900)
    log = proc.stderr.decode(errors="replace")
    starts = [float(x) for x in re.findall(r"silence_start: (-?[\d.]+)", log)]
    ends = [float(x) for x in re.findall(r"silence_end: ([\d.]+)", log)]
    return [(max(0.0, s), e) for s, e in zip(starts, ends)]


def plan_chunks(duration_s: float, silences: list[tuple[float, float]], target_s: float, window_s: float = 25.0) -> list[tuple[float, float]]:
    """Split audio into ~target_s chunks, cutting at the silence nearest to each boundary."""
    if duration_s <= target_s * 1.25:
        return [(0.0, duration_s)]
    cuts: list[float] = []
    position = 0.0
    while duration_s - position > target_s * 1.25:
        ideal = position + target_s
        near = [((s + e) / 2, e - s) for s, e in silences if abs((s + e) / 2 - ideal) <= window_s and (s + e) / 2 > position + 10]
        cut = max(near, key=lambda x: (x[1], -abs(x[0] - ideal)))[0] if near else ideal
        cuts.append(cut)
        position = cut
    bounds = [0.0, *cuts, duration_s]
    return [(bounds[i], bounds[i + 1]) for i in range(len(bounds) - 1)]


def cut_audio(audio: Path, start_s: float, end_s: float, dest: Path) -> Path:
    run_tool(["ffmpeg", "-y", "-v", "error", "-ss", f"{start_s:.3f}", "-to", f"{end_s:.3f}", "-i", str(audio), "-ac", "1", "-ar", "16000", "-c:a", "libmp3lame", "-b:a", "32k", str(dest)], timeout=600)
    return dest


def speech_regions(duration_s: float, silences: list[tuple[float, float]]) -> list[tuple[float, float]]:
    regions = []
    cursor = 0.0
    for s, e in sorted(silences):
        if s > cursor:
            regions.append((cursor, s))
        cursor = max(cursor, e)
    if cursor < duration_s:
        regions.append((cursor, duration_s))
    return [(a, b) for a, b in regions if b - a > 0.05]


def export_clip(source: Path, start_ms: int, end_ms: int, dest: Path, has_video: bool) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    start, duration = start_ms / 1000, max(0.5, (end_ms - start_ms) / 1000)
    if has_video:
        args = ["ffmpeg", "-y", "-v", "error", "-ss", f"{start:.3f}", "-i", str(source), "-t", f"{duration:.3f}", "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", str(dest)]
    else:
        args = ["ffmpeg", "-y", "-v", "error", "-ss", f"{start:.3f}", "-i", str(source), "-t", f"{duration:.3f}", "-c:a", "libmp3lame", "-b:a", "128k", str(dest)]
    run_tool(args, timeout=900)
    return dest

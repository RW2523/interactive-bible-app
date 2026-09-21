"""WebVTT / SRT caption parsing and caption generation from transcript units."""
from __future__ import annotations

import html
import re

from ..bible.text import sentence_split
from .units import Unit

TIME = re.compile(r"(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})")
ARROW = re.compile(r"^\s*(\S+)\s+-->\s+(\S+)")
VOICE = re.compile(r"<v(?:\.[^\s>]+)?\s+([^>]+)>")


def _to_ms(value: str) -> int:
    m = TIME.fullmatch(value.strip())
    if not m:
        raise ValueError(f"bad timestamp {value!r}")
    h = int(m.group(1) or 0)
    return ((h * 60 + int(m.group(2))) * 60 + int(m.group(3))) * 1000 + int(m.group(4).ljust(3, "0"))


def parse_captions(text: str) -> list[dict]:
    """Return cues: [{start_ms, end_ms, text, speaker}] from VTT or SRT."""
    text = text.replace("\r\n", "\n").replace("﻿", "")
    cues: list[dict] = []
    for block in re.split(r"\n\s*\n", text):
        lines = [ln for ln in block.split("\n") if ln.strip()]
        if not lines:
            continue
        idx = next((i for i, ln in enumerate(lines) if "-->" in ln), None)
        if idx is None:
            continue
        m = ARROW.match(lines[idx])
        if not m:
            continue
        try:
            start, end = _to_ms(m.group(1)), _to_ms(m.group(2))
        except ValueError:
            continue
        body = " ".join(lines[idx + 1 :]).strip()
        speaker = None
        vm = VOICE.search(body)
        if vm:
            speaker = vm.group(1).strip()
        body = re.sub(r"<[^>]+>", "", body)
        body = html.unescape(body).strip()
        if not body:
            continue
        cues.append({"start_ms": start, "end_ms": max(start, end), "text": body, "speaker": speaker})
    cues.sort(key=lambda c: c["start_ms"])
    return cues


# Captions mark what is not preaching: "[Music]", "[singing]", "[Applause]", "♪ …". Worship songs in a service recording
# are tagged so the pipeline maps verses from the teaching instead of from sung lyrics (and skips paid AI on them).
NON_SPEECH_RE = re.compile(r"\[(?:music|musica|singing|song|applause|laughter|cheering|silence|inaudible|instrumental|sound effects?)[^\]]*\]|[♪♫]", re.I)
NON_SPEECH_LINGER_MS = 25_000  # a cue this close to a marker on both sides is still inside the song

PAUSE_BREAK_MS = 700  # a gap this long ends a spoken phrase
MAX_SPOKEN_UNIT_MS = 9000
MAX_SPOKEN_UNIT_CHARS = 200


def mark_non_speech(cues: list[dict]) -> list[dict]:
    """Flag cues that are music/singing (by their own marker, or by sitting between two markers) as ``non_speech``."""
    marked = [bool(NON_SPEECH_RE.search(c["text"])) for c in cues]
    for i, cue in enumerate(cues):
        if marked[i]:
            cue["non_speech"] = True
            continue
        before = next((cues[j]["end_ms"] for j in range(i - 1, -1, -1) if marked[j]), None)
        after = next((cues[j]["start_ms"] for j in range(i + 1, len(cues)) if marked[j]), None)
        inside = (before is not None and cue["start_ms"] - before <= NON_SPEECH_LINGER_MS
                  and after is not None and after - cue["end_ms"] <= NON_SPEECH_LINGER_MS)
        cue["non_speech"] = inside
    return cues


def looks_unpunctuated(cues: list[dict], sample: int = 120) -> bool:
    """Auto-generated captions (YouTube ASR and most speech-to-text tools) have no sentence punctuation."""
    text = " ".join(c["text"] for c in cues[:sample])
    if not text.strip():
        return False
    sentences = sum(text.count(ch) for ch in ".!?")
    return sentences < len(text) / 400  # roughly fewer than one sentence mark per 400 characters


def cues_to_spoken_units(cues: list[dict]) -> list[Unit]:
    """Sentence-sized units from unpunctuated captions: break on speech pauses, then on length.

    Without this the whole recording is one giant 'sentence', which would leave one segment for a 40-minute sermon and
    no clip boundaries. The words are never changed - only grouped - so the transcript stays as spoken.
    """
    units: list[Unit] = []
    current: dict | None = None
    for cue in cues:
        if current is None:
            current = {**cue}
            continue
        gap = cue["start_ms"] - current["end_ms"]
        merged_chars = len(current["text"]) + 1 + len(cue["text"])
        too_long = (cue["end_ms"] - current["start_ms"]) > MAX_SPOKEN_UNIT_MS or merged_chars > MAX_SPOKEN_UNIT_CHARS
        if (gap >= PAUSE_BREAK_MS or too_long or cue["speaker"] != current["speaker"]
                or bool(cue.get("non_speech")) != bool(current.get("non_speech"))
                or re.search(r"[.!?][\"”\']?$", current["text"])):
            units.append(_spoken_unit(current))
            current = {**cue}
            continue
        current["text"] = f"{current['text']} {cue['text']}".strip()
        current["end_ms"] = cue["end_ms"]
    if current is not None:
        units.append(_spoken_unit(current))
    return [u for u in units if u.text_raw]


def _spoken_unit(cue: dict) -> Unit:
    meta = {"non_speech": True} if cue.get("non_speech") else {}
    return Unit(id="", kind="sentence", text_raw=cue["text"].strip(), start_ms=cue["start_ms"], end_ms=cue["end_ms"], speaker=cue.get("speaker"), meta=meta)


def cues_to_units(cues: list[dict]) -> list[Unit]:
    """Merge caption cues into sentence units with timings interpolated by character position.

    Captions without sentence punctuation (auto-generated ones) are grouped by pauses instead.
    """
    mark_non_speech(cues)
    if looks_unpunctuated(cues):
        return cues_to_spoken_units(cues)
    units: list[Unit] = []
    group: list[dict] = []

    def flush() -> None:
        if not group:
            return
        text_parts: list[str] = []
        char_times: list[tuple[int, int, int, int]] = []  # (char_start, char_end, start_ms, end_ms)
        pos = 0
        for cue in group:
            if text_parts:
                text_parts.append(" ")
                pos += 1
            t = cue["text"]
            char_times.append((pos, pos + len(t), cue["start_ms"], cue["end_ms"]))
            text_parts.append(t)
            pos += len(t)
        full = "".join(text_parts)

        def time_at(ch: int, end: bool) -> int:
            for cs, ce, ts, te in char_times:
                if cs <= ch <= ce:
                    frac = (ch - cs) / max(1, ce - cs)
                    return int(ts + (te - ts) * frac)
            return char_times[-1][3] if end else char_times[0][2]

        meta = {"non_speech": True} if any(c.get("non_speech") for c in group) else {}
        for s, e in sentence_split(full) or [(0, len(full))]:
            units.append(Unit(id="", kind="sentence", text_raw=full[s:e].strip(), start_ms=time_at(s, False), end_ms=time_at(e, True),
                              speaker=group[0]["speaker"], meta=dict(meta)))

    for cue in cues:
        if group and (cue["speaker"] != group[-1]["speaker"] or cue["start_ms"] - group[-1]["end_ms"] > 4000):
            flush()
            group = []
        group.append(cue)
        if re.search(r"[.!?][\"”']?$", cue["text"]):
            flush()
            group = []
    flush()
    return units


def _fmt(ms: int) -> str:
    ms = max(0, int(ms))
    h, rem = divmod(ms, 3_600_000)
    m, rem = divmod(rem, 60_000)
    s, ms = divmod(rem, 1000)
    return f"{h:02d}:{m:02d}:{s:02d}.{ms:03d}"


def units_to_vtt(units: list[dict], offset_ms: int = 0) -> str:
    lines = ["WEBVTT", ""]
    for i, u in enumerate(units, start=1):
        if u.get("start_ms") is None or u.get("end_ms") is None:
            continue
        text = u.get("text") or u.get("text_raw") or ""
        if u.get("speaker"):
            text = f"<v {u['speaker']}>{text}"
        lines += [str(i), f"{_fmt(u['start_ms'] - offset_ms)} --> {_fmt(max(u['end_ms'], u['start_ms'] + 300) - offset_ms)}", text, ""]
    return "\n".join(lines)

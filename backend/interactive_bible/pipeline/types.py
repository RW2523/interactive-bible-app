"""Pipeline data structures."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from ..bible import books as B

TYPE_PRIORITY = {"human_verified": 5, "direct_reference": 4, "scripture_quote": 3, "contextual_reference": 2, "ai_related": 1}
TYPE_LABEL = {
    "direct_reference": "Direct Mention",
    "scripture_quote": "Scripture Quote",
    "contextual_reference": "Contextual Reference",
    "ai_related": "AI Related",
}


@dataclass
class Detection:
    start: int
    end: int
    type: str
    subtype: str | None
    confidence: float
    evidence_text: str
    spans: list[tuple[int, int]]
    detectors: list[str]
    why_related: str | None = None
    signals: dict[str, Any] = field(default_factory=dict)
    review_reasons: list[str] = field(default_factory=list)
    needs_review: bool = False

    @property
    def key(self) -> tuple[int, int]:
        return (self.start, self.end)

    @property
    def canonical(self) -> str:
        return B.canonical_range_str(self.start, self.end)

    @property
    def is_range(self) -> bool:
        return self.end != self.start


@dataclass
class Mapping(Detection):
    primary: bool = False
    mention_count: int = 1
    review_status: str = "published"
    audit: dict[str, Any] = field(default_factory=dict)
    provenance: dict[str, Any] = field(default_factory=dict)
    evidence_times: list[tuple[int | None, int | None]] = field(default_factory=list)


@dataclass
class SegmentWork:
    """Everything the analysis stages know about one segment."""

    id: str
    ordinal: int
    text: str
    transcript_raw: str
    unit_ids: list[str]
    unit_offsets: list[dict[str, Any]]  # [{id, start, end, start_ms, end_ms, page, speaker, text}] relative to text
    start_ms: int | None
    end_ms: int | None
    page_start: int | None
    page_end: int | None
    char_start: int
    char_end: int
    heading: str | None
    speaker: str | None
    context_before: str
    context_after: str
    preceding_text: str
    topic_hint: str | None = None
    boundary_reason: str | None = None
    non_speech_ratio: float = 0.0  # share of the text that captions marked as music/singing/applause
    part: str = "message"  # message | worship | welcome | announcements | prayer | scripture_reading | communion | testimony | other
    detections: list[Detection] = field(default_factory=list)
    mappings: list[Mapping] = field(default_factory=list)
    summary: str | None = None
    summary_provenance: dict[str, Any] | None = None
    tags: dict[str, list[dict[str, Any]]] = field(default_factory=dict)
    tags_provenance: dict[str, Any] = field(default_factory=dict)
    clip: dict[str, Any] | None = None
    embeddings: dict[str, tuple[str, list[float]]] = field(default_factory=dict)  # purpose -> (model, vector)
    content_hash: str = ""
    notes: list[str] = field(default_factory=list)
    ai_calls: list[dict[str, Any]] = field(default_factory=list)

    def unit_times_for_span(self, start: int, end: int) -> tuple[int | None, int | None]:
        hits = [u for u in self.unit_offsets if u["start"] < end and u["end"] > start]
        if not hits or hits[0].get("start_ms") is None:
            return None, None
        return hits[0]["start_ms"], hits[-1]["end_ms"]

    def sentence_for_span(self, start: int, end: int, max_chars: int = 320) -> str:
        hits = [u for u in self.unit_offsets if u["start"] < end and u["end"] > start]
        if not hits:
            return self.text[max(0, start - 80) : end + 80].strip()
        s, e = hits[0]["start"], hits[-1]["end"]
        text = self.text[s:e].strip()
        if len(text) > max_chars:
            rel = start - s
            lo = max(0, rel - max_chars // 3)
            text = ("…" if lo > 0 else "") + text[lo : lo + max_chars].strip() + "…"
        return text

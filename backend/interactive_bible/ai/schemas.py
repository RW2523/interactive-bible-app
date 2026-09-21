"""Machine-validated output schemas for every prompt (spec §10: 'Every prompt must return machine-validated JSON')."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator

Confidence = Field(default=0.0, ge=0.0, le=1.0)


class _Base(BaseModel):
    model_config = {"extra": "ignore"}


# P-00
def _seconds(value):
    """Accept 12.5, "12.5", "00:12.5", "1:02:03" -> seconds."""
    if isinstance(value, (int, float)):
        return max(0.0, float(value))
    if isinstance(value, str):
        text = value.strip().rstrip("s")
        try:
            parts = [float(p) for p in text.split(":")]
        except ValueError:
            return value
        total = 0.0
        for p in parts:
            total = total * 60 + p
        return max(0.0, total)
    return value


class Utterance(_Base):
    start: float = Field(ge=0)
    end: float = Field(ge=0)
    speaker: str | None = None
    text: str

    @field_validator("start", "end", mode="before")
    @classmethod
    def _time(cls, v):
        return _seconds(v)


class TranscriptOut(_Base):
    language: str | None = None
    utterances: list[Utterance]


# P-01
class SegmentBoundary(_Base):
    start: float | None = None
    end: float | None = None
    unit_ids: list[str]
    topic_hint: str | None = None
    boundary_reason: str | None = None


class SegmenterOut(_Base):
    segments: list[SegmentBoundary]


# P-02
class ExtractedRef(_Base):
    raw_text: str
    canonical_start: str
    canonical_end: str | None = None
    evidence_quote: str
    confidence: float = Confidence


class RefExtractorOut(_Base):
    references: list[ExtractedRef] = []


# P-03
class QuoteMatch(_Base):
    verse: str
    classification: Literal["exact_quote", "close_quote", "paraphrase", "theme_only", "unrelated"]
    evidence: str = ""
    confidence: float = Confidence


class QuoteVerifierOut(_Base):
    matches: list[QuoteMatch] = []


# P-04
class AcceptedVerse(_Base):
    verse: str
    relationship: Literal["thematic", "conceptual", "narrative_parallel", "question_answer", "doctrinal_context"]
    evidence: str
    why_related: str
    confidence: float = Confidence


class RejectedVerse(_Base):
    verse: str
    reason: str = ""


class SemanticMapperOut(_Base):
    accepted: list[AcceptedVerse] = []
    rejected: list[RejectedVerse] = []


# P-05
class FinalRelationship(_Base):
    verse: str
    type: Literal["direct_reference", "scripture_quote", "contextual_reference", "ai_related"]
    confidence: float = Confidence
    evidence: str = ""
    primary: bool = False


class ClassifierOut(_Base):
    primary_verse: str | None = None
    relationships: list[FinalRelationship] = []

    @field_validator("primary_verse")
    @classmethod
    def _null(cls, v: str | None) -> str | None:
        return None if v in (None, "", "null", "None") else v


# P-06 / P-15
class Tag(_Base):
    name: str
    confidence: float = 0.7


def _coerce_tags(v):  # accept ["faith"] as well as [{"name": "faith"}]
    if isinstance(v, list):
        return [{"name": x} if isinstance(x, str) else x for x in v]
    return v


class TaggerOut(_Base):
    topics: list[Tag] = []
    people: list[Tag] = []
    places: list[Tag] = []
    events: list[Tag] = []
    life_situations: list[Tag] = []
    questions: list[Tag] = []

    @field_validator("topics", "people", "places", "events", "life_situations", "questions", mode="before")
    @classmethod
    def _tags(cls, v):
        return _coerce_tags(v)


# P-07
class SummaryOut(_Base):
    summary: str


# P-08
class ClipOut(_Base):
    start_ms: int
    end_ms: int
    core_start_ms: int
    core_end_ms: int
    reason: str = ""
    confidence: float = Confidence


# P-16
MESSAGE_PARTS = ("message", "worship", "welcome", "announcements", "prayer", "scripture_reading", "communion", "testimony", "other")


class SectionPart(_Base):
    ordinal: int
    part: str = "other"

    @field_validator("part")
    @classmethod
    def _known(cls, v: str) -> str:
        v = (v or "").strip().lower().replace(" ", "_")
        return v if v in MESSAGE_PARTS else "other"


class MessageLocationOut(_Base):
    parts: list[SectionPart] = []
    message_start_ordinal: int = -1
    message_end_ordinal: int = -1
    confidence: float = 0.0
    reason: str = ""


# P-09
class WhyOut(_Base):
    why_related: str
    confidence: float = Confidence


# P-10
class SearchParseOut(_Base):
    explicit_refs: list[str] = []
    topics: list[str] = []
    entities: list[str] = []
    resource_types: list[str] = []
    semantic_query: str = ""
    search_scope: Literal["bible", "resources", "both"] = "both"


# P-11
class RankedItem(_Base):
    id: str
    score: float = Confidence
    reason: str = ""


class RerankOut(_Base):
    ranked: list[RankedItem] = []


# P-12
class AuditIssue(_Base):
    verse: str
    reason: str = ""


class AuditOut(_Base):
    approved: list[str] = []
    needs_review: list[AuditIssue] = []
    rejected: list[AuditIssue] = []

    @field_validator("approved", mode="before")
    @classmethod
    def _approved(cls, v):
        if isinstance(v, list):
            return [x.get("verse", "") if isinstance(x, dict) else x for x in v]
        return v


# P-13
class CaptionOut(_Base):
    hook: str
    verse_label: str
    caption_lines: list[str]
    description: str


# P-14
class Citation(_Base):
    kind: Literal["verse", "segment"]
    id: str


class AskOut(_Base):
    answer: str
    citations: list[Citation] = []
    interpretive_note: str | None = None
    confidence: float = Confidence

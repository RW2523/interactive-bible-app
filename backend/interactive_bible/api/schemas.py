"""Request models for the HTTP API."""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator


class LoginIn(BaseModel):
    email: str
    password: str


class SignupIn(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=8, max_length=200)
    display_name: str = Field(min_length=1, max_length=80)
    church: str | None = Field(default=None, max_length=120)


class ProfileIn(BaseModel):
    display_name: str | None = Field(default=None, min_length=1, max_length=80)
    church: str | None = Field(default=None, max_length=120)
    current_password: str | None = None
    new_password: str | None = Field(default=None, min_length=8, max_length=200)


class ResourceIn(BaseModel):
    type: Literal["video", "audio", "pdf", "document", "article", "native", "generated"]
    title: str = Field(min_length=1, max_length=300)
    category: str | None = "other"
    description: str | None = None
    visibility: Literal["private", "organization", "unlisted", "public"] = "private"
    rights_status: Literal["owned", "licensed", "embed_only", "unknown"] = "unknown"
    allow_clip_export: bool = False
    is_official: bool = False
    requires_review: bool = False
    language: str = "en"
    author: str | None = None
    speaker: str | None = None
    series: str | None = None
    organization_id: str | None = None
    url: str | None = None
    body_text: str | None = Field(default=None, max_length=2_000_000)
    duration_ms: int | None = None
    transcript_mode: Literal["auto", "gemini", "captions"] = "auto"
    pii_redaction: bool = True
    verse_hints: list[str] = []
    topic_hints: list[str] = []
    generation_provenance: dict[str, Any] | None = None
    metadata: dict[str, Any] | None = None

    @field_validator("verse_hints", "topic_hints", mode="before")
    @classmethod
    def _split(cls, v: Any) -> Any:
        if isinstance(v, str):
            return [x.strip() for x in v.split(",") if x.strip()]
        return v


class ResourcePatch(BaseModel):
    title: str | None = None
    description: str | None = None
    category: str | None = None
    visibility: Literal["private", "organization", "unlisted", "public"] | None = None
    rights_status: Literal["owned", "licensed", "embed_only", "unknown"] | None = None
    allow_clip_export: bool | None = None
    is_official: bool | None = None
    requires_review: bool | None = None
    language: str | None = None
    author: str | None = None
    speaker: str | None = None
    series: str | None = None
    transcript_mode: Literal["auto", "gemini", "captions"] | None = None
    pii_redaction: bool | None = None
    verse_hints: list[str] | None = None
    topic_hints: list[str] | None = None
    organization_id: str | None = None


class ProcessIn(BaseModel):
    reset_human: bool = False
    force_retranscribe: bool = False
    disable_ai: bool = False
    force: bool = False


class SearchIn(BaseModel):
    query: str = Field(min_length=1, max_length=500)
    scope: Literal["bible", "resources", "both"] | None = None
    translation: str = "web"
    limit: int = Field(default=12, ge=1, le=50)
    resource_types: list[str] = []
    no_rerank: bool = False


class FeedbackIn(BaseModel):
    object_type: Literal["mapping", "segment", "resource", "verse_relationship"]
    object_id: str
    kind: Literal["not_relevant", "wrong_verse", "wrong_timestamp", "wrong_quote_reference", "report_content", "helpful"]
    note: str | None = Field(default=None, max_length=2000)


class FeedbackPatch(BaseModel):
    status: Literal["open", "in_review", "resolved", "dismissed"]
    note: str | None = None


class AskIn(BaseModel):
    ref: str
    question: str = Field(min_length=3, max_length=800)
    translation: str = "web"


class UrlIn(BaseModel):
    url: str = Field(min_length=5, max_length=2000)


class NoteIn(BaseModel):
    note: str | None = None


class MappingPatch(BaseModel):
    relationship_type: Literal["direct_reference", "scripture_quote", "contextual_reference", "ai_related"] | None = None
    relationship_subtype: str | None = None
    confidence_override: float | None = Field(default=None, ge=0, le=1)
    evidence_text: str | None = None
    why_related: str | None = None
    verse_ref: str | None = None
    primary: bool | None = None
    note: str | None = None


class MappingIn(BaseModel):
    segment_id: str
    verse_ref: str
    relationship_type: Literal["direct_reference", "scripture_quote", "contextual_reference", "ai_related"] = "direct_reference"
    evidence_text: str | None = None
    why_related: str | None = None
    primary: bool = False
    note: str | None = None


class MergeIn(BaseModel):
    mapping_ids: list[str] = Field(min_length=2)
    note: str | None = None


class PrimaryIn(BaseModel):
    mapping_id: str
    note: str | None = None


class ClipPatch(BaseModel):
    start_ms: int | None = None
    end_ms: int | None = None
    core_start_ms: int | None = None
    core_end_ms: int | None = None
    reason: str | None = None
    approve_only: bool = False
    note: str | None = None


class TagsPatch(BaseModel):
    add_topics: list[str] = []
    remove_topics: list[str] = []
    add_entities: list[str] = []
    remove_entities: list[str] = []
    note: str | None = None


class VocabIn(BaseModel):
    id: str | None = None
    name: str
    slug: str | None = None
    key: str | None = None
    category: str | None = None
    type: Literal["person", "place", "event", "question", "life_situation"] | None = None
    description: str | None = None
    aliases: list[str] = []
    passages: list[str] = []
    link_passages: bool = False

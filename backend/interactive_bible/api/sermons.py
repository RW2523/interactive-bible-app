"""Sermon Studio API (collect -> polish -> visuals -> export & share).

Sermons are private to their author: another user's sermon is a 404, for admins too. Endpoints that call Gemini use
``creative_ai_limit`` (signed in + hourly cap). Generated and uploaded files are served through signed ``/v1/files`` URLs.
``GET /v1/share/{slug}`` is the public page of a published sermon.
"""
from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Depends, File, UploadFile
from pydantic import AliasChoices, BaseModel, Field
from sqlalchemy.orm import Session

from ..security import Viewer
from ..services.sermons import catalog, inputs, store, visuals, writing
from .deps import creative_ai_limit, get_session, rate_limit, require_user
from .util import json_safe

router = APIRouter(prefix="/v1", tags=["sermons"])

SermonStatus = Literal["draft", "polished", "multimedia", "exported", "published"]
ExportTheme = Literal["navy_gold", "light_classic", "royal_purple", "minimal_slate", "warm_sand"]
TemplateType = Literal["prayer", "message", "story", "devotional", "teaching", "testimony", "youth", "small_group", "storytelling", "custom"]
MediaKind = Literal["image", "map", "timeline", "scripture_slide", "graphic"]


# ----------------------------------------------------------------------------- request models
class SermonCreate(BaseModel):
    title: str | None = Field(default=None, max_length=2000)  # trimmed, then at most 200 characters


class SermonPatch(BaseModel):
    title: str | None = Field(default=None, max_length=2000)
    scripture_ref: str | None = Field(default=None, max_length=300)
    theme: str | None = Field(default=None, max_length=1000)
    status: SermonStatus | None = None
    current_stage: int | None = None
    tone: str | None = Field(default=None, max_length=40)
    language: str | None = Field(default=None, max_length=40)
    export_template: ExportTheme | None = None


class InputIn(BaseModel):
    kind: Literal["text", "dictation", "bible_ref"]
    text: str | None = Field(default=None, validation_alias=AliasChoices("text", "raw_text"))
    reference: str | None = Field(default=None, max_length=300)
    notes: str | None = None
    translation: str | None = Field(default=None, max_length=10)


class PolishIn(BaseModel):
    tone: str | None = Field(default=None, max_length=40)
    language: str | None = Field(default=None, max_length=40)
    style: TemplateType | None = None


class TemplateIn(BaseModel):
    draft_id: str = Field(max_length=64)
    template_type: TemplateType
    tone: str | None = Field(default=None, max_length=40)
    language: str | None = Field(default=None, max_length=40)


class SuggestionsIn(BaseModel):
    draft_id: str | None = Field(default=None, max_length=64)


class PointIn(BaseModel):
    heading: str | None = Field(default="", max_length=500)
    body: str | None = Field(default="", max_length=30_000)
    scripture: str | None = Field(default=None, max_length=5_000)


class StructuredIn(BaseModel):
    title: str | None = Field(default="", max_length=300)
    theme: str | None = Field(default="", max_length=2_000)
    scripture: str | None = Field(default="", max_length=5_000)
    introduction: str | None = Field(default="", max_length=50_000)
    main_points: list[PointIn] = Field(default_factory=list, max_length=40)
    applications: list[str] = Field(default_factory=list, max_length=60)
    conclusion: str | None = Field(default="", max_length=50_000)
    prayer: str | None = Field(default="", max_length=20_000)


class DraftPatch(BaseModel):
    polished_html: str | None = None
    structured: StructuredIn | None = None
    speaker_notes: str | None = None


class SpeakerNotesIn(BaseModel):
    draft_id: str = Field(max_length=64)


class PlanIn(BaseModel):
    theme_id: ExportTheme | None = None
    target_slide_count: int | None = Field(default=None, ge=0, le=1000)  # clamped to 10..40


class MediaGenerateIn(BaseModel):
    kind: MediaKind = "image"
    prompt: str | None = Field(default=None, max_length=2_000)
    auto_prompt: bool = False
    high_quality: bool = False
    regenerate_id: str | None = Field(default=None, max_length=64)


class MediaSetIn(BaseModel):
    count: int = Field(default=6, ge=0, le=100)  # clamped to 2..8
    high_quality: bool = False


class MediaPatch(BaseModel):
    caption: str | None = Field(default=None, max_length=300)


class OutreachPatch(BaseModel):
    is_public: bool


# ----------------------------------------------------------------------------- sermons
@router.get("/sermons/meta")
def sermon_meta() -> dict[str, Any]:
    """Tones, languages, sermon formats and export themes (registered before /sermons/{sermon_id})."""
    return catalog.meta()


@router.get("/sermons")
def list_sermons(session: Session = Depends(get_session), viewer: Viewer = Depends(require_user)):
    return json_safe(store.list_sermons(session, viewer))


@router.post("/sermons", status_code=201)
def create_sermon(body: SermonCreate | None = None, session: Session = Depends(get_session), viewer: Viewer = Depends(require_user)):
    return json_safe(store.create_sermon(session, viewer, (body or SermonCreate()).title))


@router.get("/sermons/{sermon_id}")
def sermon_detail(sermon_id: str, session: Session = Depends(get_session), viewer: Viewer = Depends(require_user)):
    return json_safe(store.sermon_detail(session, viewer, sermon_id))


@router.patch("/sermons/{sermon_id}")
def update_sermon(sermon_id: str, body: SermonPatch, session: Session = Depends(get_session), viewer: Viewer = Depends(require_user)):
    return json_safe(store.update_sermon(session, viewer, sermon_id, body.model_dump(exclude_unset=True)))


@router.delete("/sermons/{sermon_id}")
def delete_sermon(sermon_id: str, session: Session = Depends(get_session), viewer: Viewer = Depends(require_user)):
    return store.delete_sermon(session, viewer, sermon_id)


# ----------------------------------------------------------------------------- stage 1: inputs
@router.post("/sermons/{sermon_id}/inputs", status_code=201)
def add_input(sermon_id: str, body: InputIn, session: Session = Depends(get_session), viewer: Viewer = Depends(require_user)):
    if body.kind == "bible_ref":
        return json_safe(inputs.add_bible_ref_input(session, viewer, sermon_id, body.reference, body.notes, body.translation))
    return json_safe(inputs.add_text_input(session, viewer, sermon_id, body.kind, body.text))


@router.post("/sermons/{sermon_id}/inputs/audio", status_code=201)
def add_audio_input(sermon_id: str, file: UploadFile = File(...), session: Session = Depends(get_session), viewer: Viewer = Depends(creative_ai_limit)):
    return json_safe(inputs.add_audio_input(session, viewer, sermon_id, file.file, file.filename))


@router.post("/sermons/{sermon_id}/inputs/document", status_code=201, dependencies=[Depends(rate_limit("upload", 30))])
def add_document_input(sermon_id: str, file: UploadFile = File(...), session: Session = Depends(get_session), viewer: Viewer = Depends(require_user)):
    return json_safe(inputs.add_document_input(session, viewer, sermon_id, file.file, file.filename))


@router.delete("/sermons/{sermon_id}/inputs/{input_id}")
def delete_input(sermon_id: str, input_id: str, session: Session = Depends(get_session), viewer: Viewer = Depends(require_user)):
    return inputs.delete_input(session, viewer, sermon_id, input_id)


# ----------------------------------------------------------------------------- stage 2: polish
@router.post("/sermons/{sermon_id}/polish")
def polish(sermon_id: str, body: PolishIn | None = None, session: Session = Depends(get_session), viewer: Viewer = Depends(creative_ai_limit)):
    body = body or PolishIn()
    return json_safe(writing.polish(session, viewer, sermon_id, tone=body.tone, language=body.language, style=body.style))


@router.post("/sermons/{sermon_id}/template")
def apply_template(sermon_id: str, body: TemplateIn, session: Session = Depends(get_session), viewer: Viewer = Depends(creative_ai_limit)):
    return json_safe(writing.apply_format(session, viewer, sermon_id, body.draft_id, body.template_type, tone=body.tone, language=body.language))


@router.post("/sermons/{sermon_id}/suggestions")
def suggestions(sermon_id: str, body: SuggestionsIn | None = None, session: Session = Depends(get_session), viewer: Viewer = Depends(creative_ai_limit)):
    return json_safe(writing.suggestions(session, viewer, sermon_id, (body or SuggestionsIn()).draft_id))


@router.patch("/sermons/{sermon_id}/drafts/{draft_id}")
def update_draft(sermon_id: str, draft_id: str, body: DraftPatch, session: Session = Depends(get_session), viewer: Viewer = Depends(require_user)):
    return json_safe(writing.update_draft(session, viewer, sermon_id, draft_id, body.model_dump(exclude_unset=True)))


# ----------------------------------------------------------------------------- stage 3: visuals
@router.post("/sermons/{sermon_id}/media/generate")
def generate_media(sermon_id: str, body: MediaGenerateIn, session: Session = Depends(get_session), viewer: Viewer = Depends(creative_ai_limit)):
    return json_safe(visuals.generate_media(session, viewer, sermon_id, kind=body.kind, prompt=body.prompt, auto_prompt=body.auto_prompt,
                                            high_quality=body.high_quality, regenerate_id=body.regenerate_id))


@router.post("/sermons/{sermon_id}/media/set")
def generate_media_set(sermon_id: str, body: MediaSetIn | None = None, session: Session = Depends(get_session), viewer: Viewer = Depends(creative_ai_limit)):
    body = body or MediaSetIn()
    return json_safe(visuals.generate_media_set(session, viewer, sermon_id, count=body.count, high_quality=body.high_quality))


@router.patch("/sermons/{sermon_id}/media/{media_id}")
def update_media(sermon_id: str, media_id: str, body: MediaPatch, session: Session = Depends(get_session), viewer: Viewer = Depends(require_user)):
    return json_safe(visuals.update_media(session, viewer, sermon_id, media_id, body.caption))


@router.delete("/sermons/{sermon_id}/media/{media_id}")
def delete_media(sermon_id: str, media_id: str, session: Session = Depends(get_session), viewer: Viewer = Depends(require_user)):
    return visuals.delete_media(session, viewer, sermon_id, media_id)


# ----------------------------------------------------------------------------- stage 4: export & share
@router.post("/sermons/{sermon_id}/speaker-notes")
def speaker_notes(sermon_id: str, body: SpeakerNotesIn, session: Session = Depends(get_session), viewer: Viewer = Depends(creative_ai_limit)):
    return json_safe(writing.speaker_notes(session, viewer, sermon_id, body.draft_id))


@router.post("/sermons/{sermon_id}/plan")
def slide_plan(sermon_id: str, body: PlanIn | None = None, session: Session = Depends(get_session), viewer: Viewer = Depends(creative_ai_limit)):
    body = body or PlanIn()
    return json_safe(visuals.build_plan(session, viewer, sermon_id, theme_id=body.theme_id, target_slide_count=body.target_slide_count))


@router.post("/sermons/{sermon_id}/outreach")
def generate_outreach(sermon_id: str, session: Session = Depends(get_session), viewer: Viewer = Depends(creative_ai_limit)):
    return json_safe(writing.generate_outreach(session, viewer, sermon_id))


@router.patch("/sermons/{sermon_id}/outreach")
def publish_outreach(sermon_id: str, body: OutreachPatch, session: Session = Depends(get_session), viewer: Viewer = Depends(require_user)):
    return json_safe(writing.set_outreach_visibility(session, viewer, sermon_id, body.is_public))


@router.get("/share/{slug}", dependencies=[Depends(rate_limit("share"))])
def share_page(slug: str, session: Session = Depends(get_session)):
    """Public page of a published sermon (no sign-in)."""
    return json_safe(writing.share_page(session, slug))

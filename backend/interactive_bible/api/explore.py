"""Explore API: Bible events atlas, AI event content, story videos, event illustrations, timeline AI."""
from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..security import Viewer
from ..services.explore import cards, content, data, stories, timeline, video
from .deps import creative_ai_limit, get_session, get_viewer, require_user
from .util import json_safe

router = APIRouter(prefix="/v1/explore", tags=["explore"])

StoryFormat = Literal["landscape", "portrait"]


class StoryIn(BaseModel):
    sceneCount: int = Field(stories.DEFAULT_SCENES, ge=stories.MIN_SCENES, le=stories.MAX_SCENES)
    force: bool = False
    imageFormat: StoryFormat = "landscape"


class StoryVideoIn(BaseModel):
    format: StoryFormat = "landscape"


class EventCardIn(BaseModel):
    force: bool = False


class EventRef(BaseModel):
    model_config = {"extra": "ignore"}  # older clients send the whole event object: only its id is used

    id: str = Field(min_length=1, max_length=200)


class TimelineExplainIn(BaseModel):
    eventId: str | None = Field(default=None, min_length=1, max_length=200)
    event: EventRef | None = None
    mode: Literal["simple", "kids", "pastor", "study"] = "simple"


class TimelineStoryIn(BaseModel):
    eventIds: list[str] | None = Field(default=None, min_length=1, max_length=timeline.MAX_STORY_EVENTS)
    events: list[EventRef] | None = Field(default=None, min_length=1, max_length=timeline.MAX_STORY_EVENTS)
    audience: Literal["general", "kids", "youth", "pastor"] = "general"
    duration: Literal["short", "medium"] = "short"


def _json_bytes(request: Request, body: bytes, etag: str) -> Response:
    """Large, rarely changing data files: revalidate with an ETag instead of re-sending them."""
    headers = {"etag": etag, "cache-control": "no-cache"}
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers=headers)
    return Response(content=body, media_type="application/json", headers=headers)


# ----------------------------------------------------------------------------- events + timeline data
@router.get("/events")
def list_events(request: Request):
    atlas = data.atlas()
    return _json_bytes(request, atlas.items_json, atlas.etag)


@router.get("/events/{event_id}")
def event_detail(event_id: str):
    return data.get_event(event_id)


@router.get("/timeline")
def timeline_bundle(request: Request):
    bundle = data.timeline()
    return _json_bytes(request, bundle.raw_json, bundle.etag)


@router.get("/by-verse/{ref}")
def events_by_verse(ref: str, limit: int = Query(20, ge=1, le=100)):
    """Atlas and timeline events whose Scripture references overlap a verse or passage (e.g. ROM.8.28, Luke 2:1-20)."""
    return data.events_for_reference(ref, limit)


# ----------------------------------------------------------------------------- AI event content
@router.post("/events/{event_id}/content")
def generate_event_content(event_id: str, viewer: Viewer = Depends(creative_ai_limit)):
    return content.generate_content(event_id)


@router.get("/events/{event_id}/content")
def event_content(event_id: str):
    return content.cached_content(event_id)


# ----------------------------------------------------------------------------- story videos
@router.get("/events/{event_id}/story/meta")
def story_meta(event_id: str, session: Session = Depends(get_session), viewer: Viewer = Depends(get_viewer)):
    return json_safe(stories.story_meta(session, viewer, event_id))


@router.get("/events/{event_id}/story")
def story(event_id: str, format: StoryFormat = Query("landscape"), session: Session = Depends(get_session)):
    return json_safe(stories.get_story(session, event_id, format))


@router.post("/events/{event_id}/story")
def create_story(event_id: str, body: StoryIn | None = None, session: Session = Depends(get_session), viewer: Viewer = Depends(creative_ai_limit)):
    body = body or StoryIn()
    status, payload = stories.request_story(session, viewer, event_id, body.sceneCount, body.force, body.imageFormat)
    return JSONResponse(json_safe(payload), status_code=status)


@router.post("/events/{event_id}/story/video", status_code=202)
def export_story_video(event_id: str, body: StoryVideoIn | None = None, session: Session = Depends(get_session), viewer: Viewer = Depends(require_user)):
    return video.request_export(session, viewer, event_id, (body or StoryVideoIn()).format)


# ----------------------------------------------------------------------------- event illustrations
@router.get("/events/{event_id}/event-card")
def event_card(event_id: str, session: Session = Depends(get_session)):
    return json_safe(cards.get_card(session, event_id))


@router.post("/events/{event_id}/event-card")
def create_event_card(event_id: str, body: EventCardIn | None = None, session: Session = Depends(get_session),
                      viewer: Viewer = Depends(creative_ai_limit)):
    return json_safe(cards.create_card(session, viewer, event_id, (body or EventCardIn()).force))


# ----------------------------------------------------------------------------- timeline AI
@router.post("/timeline/explain")
def explain_timeline_event(body: TimelineExplainIn, viewer: Viewer = Depends(creative_ai_limit)):
    event_id = body.eventId or (body.event.id if body.event else None)
    if not event_id:
        raise HTTPException(status_code=422, detail="eventId is required")
    return timeline.explain(event_id, body.mode)


@router.post("/timeline/story-mode")
def timeline_story_mode(body: TimelineStoryIn, viewer: Viewer = Depends(creative_ai_limit)):
    event_ids = body.eventIds if body.eventIds is not None else [e.id for e in body.events or []]
    if not event_ids:
        raise HTTPException(status_code=422, detail="eventIds is required")
    return timeline.story_mode(event_ids, body.audience, body.duration)

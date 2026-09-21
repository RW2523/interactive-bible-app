"""Event illustrations: one AI image for an atlas event's map card, generated only when a user asks for it."""
from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from ... import storage
from ...ai.llm import get_llm
from ...db import fetch_one, session_scope
from ...ids import new_id
from ...security import Viewer
from . import data
from .common import IMAGE_TYPES, image_extension, storage_segment

IMAGE_PURPOSE = "IMG:explore"


def build_event_card_prompt(event: dict[str, Any]) -> str:
    return (
        "Wide cinematic landscape illustration for a Bible atlas app hero background (no text, no letters, no watermark).\n"
        f"Subject: {event.get('title') or event['id']}\n"
        f"Location: {event.get('mapLocation') or 'biblical lands'}\n"
        f"Era: {event.get('era') or 'biblical'}\n"
        "Style: premium illustrated Bible storybook / parchment map aesthetic, warm golden-hour light, soft painterly detail, "
        "reverent and educational, no gore, no modern objects or people in contemporary dress."
    )


def _current(session: Session, event_id: str) -> dict[str, Any] | None:
    row = fetch_one(session, "SELECT storage_key, created_at FROM explore_event_cards WHERE event_id = :e", e=event_id)
    return row if row and storage.exists(row["storage_key"]) else None


def get_card(session: Session, event_id: str) -> dict[str, Any]:
    data.get_event(event_id)
    row = _current(session, event_id)
    if not row:
        return {"cached": False, "imageUrl": None, "createdAt": None}
    return {"cached": True, "imageUrl": storage.signed_url(row["storage_key"]), "createdAt": row["created_at"]}


def create_card(session: Session, viewer: Viewer, event_id: str, force: bool = False) -> dict[str, Any]:
    event = data.get_event(event_id)
    storage_segment(event["id"])
    row = _current(session, event_id)
    if row and not force:
        return {"cached": True, "imageUrl": storage.signed_url(row["storage_key"]), "mode": "gemini", "createdAt": row["created_at"]}
    prompt = build_event_card_prompt(event)
    image = get_llm().image(prompt, IMAGE_PURPOSE, aspect_ratio="16:9")
    ext = image_extension(image.mime_type, image.data)
    key = storage.put_bytes(f"explore/event-cards/{event_id}/{new_id('card')}.{ext}", image.data)
    try:
        with session_scope() as s:  # commit before the previous file is removed
            previous = fetch_one(s, "SELECT storage_key FROM explore_event_cards WHERE event_id = :e FOR UPDATE", e=event_id)
            saved = fetch_one(s, """INSERT INTO explore_event_cards (event_id, storage_key, mime_type, prompt, model, created_by)
                                    VALUES (:e, :k, :mime, :p, :model, (SELECT id FROM users WHERE id = :u))
                                    ON CONFLICT (event_id) DO UPDATE SET storage_key = EXCLUDED.storage_key, mime_type = EXCLUDED.mime_type,
                                        prompt = EXCLUDED.prompt, model = EXCLUDED.model, created_by = EXCLUDED.created_by, created_at = now()
                                    RETURNING created_at""",
                              e=event_id, k=key, mime=IMAGE_TYPES[ext], p=prompt, model=image.model, u=viewer.user_id)
    except Exception:
        storage.delete_key(key)
        raise
    if previous and previous["storage_key"] != key:
        storage.delete_key(previous["storage_key"])
    return {"cached": False, "imageUrl": storage.signed_url(key), "mode": "gemini", "createdAt": saved["created_at"]}

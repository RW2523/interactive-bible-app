"""Sermon CRUD, owner-only access and JSON serialisation.

Sermons are private to their author: another user's sermon is reported as not found, for admins too. Generated and uploaded
files live under ``sermons/{user_id}/{sermon_id}/`` in local storage and are served through signed ``/v1/files`` URLs that are
computed when a row is serialised (storage keys are what the database keeps).
"""
from __future__ import annotations

import copy
from typing import Any

from sqlalchemy.orm import Session

from ... import storage
from ...db import execute, fetch_all, fetch_one
from ...ids import new_id
from ...security import Viewer
from ..bible import NotFound
from .catalog import DEFAULT_TITLE, EXPORT_THEMES, LANGUAGE_CODES, STATUSES, TONE_IDS

SERMON_FIELDS = ("id", "title", "status", "current_stage", "scripture_ref", "theme", "tone", "language", "export_template", "created_at", "updated_at")
EDITABLE_FIELDS = ("title", "scripture_ref", "theme", "status", "current_stage", "tone", "language", "export_template")
MAX_TITLE = 200


def sermon_prefix(user_id: str, sermon_id: str) -> str:
    return f"sermons/{user_id}/{sermon_id}"


# ---------------------------------------------------------------------------------------------- serialisation
def serialize_sermon(row: dict[str, Any]) -> dict[str, Any]:
    return {k: row.get(k) for k in SERMON_FIELDS}


def input_text(row: dict[str, Any]) -> str:
    return row.get("transcription") or row.get("raw_text") or ""


def serialize_input(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"], "kind": row["kind"], "text": input_text(row), "raw_text": row.get("raw_text"), "transcription": row.get("transcription"),
        "original_filename": row.get("original_filename"), "meta": row.get("meta") or {}, "created_at": row.get("created_at"),
    }


def with_image_urls(plan: Any) -> Any:
    """A copy of a slide plan whose scene visuals carry ``imageUrl`` signed from the stored ``imageKey``."""
    if not isinstance(plan, dict):
        return plan
    out = copy.deepcopy(plan)
    for slide in out.get("slides") or []:
        visual = slide.get("visual") if isinstance(slide, dict) else None
        if not isinstance(visual, dict):
            continue
        if visual.get("imageKey"):
            visual["imageUrl"] = storage.signed_url(visual["imageKey"])
        else:
            visual.pop("imageUrl", None)
    return out


def serialize_draft(row: dict[str, Any] | None) -> dict[str, Any] | None:
    if not row:
        return None
    provenance = {k: v for k, v in (row.get("provenance") or {}).items() if k != "scene_images"}  # internal image cache
    return {
        "id": row["id"], "sermon_id": row["sermon_id"], "version": row["version"], "template_type": row["template_type"],
        "structured": row.get("structured"), "polished_html": row.get("polished_html"), "speaker_notes": row.get("speaker_notes"),
        "slide_plan": with_image_urls(row.get("slide_plan")), "provenance": provenance, "created_at": row.get("created_at"), "updated_at": row.get("updated_at"),
    }


def serialize_media(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"], "kind": row["kind"], "prompt": row.get("prompt"), "caption": row.get("caption"), "order_index": row["order_index"],
        "url": storage.signed_url(row["storage_key"]), "mime_type": row.get("mime_type"), "created_at": row.get("created_at"),
    }


def serialize_outreach(row: dict[str, Any] | None) -> dict[str, Any] | None:
    if not row:
        return None
    return {
        "id": row["id"], "share_slug": row["share_slug"], "is_public": row["is_public"], "summary": row.get("summary"),
        "social_caption": row.get("social_caption"), "hashtags": list(row.get("hashtags") or []), "social": row.get("social") or {},
        "published_at": row.get("published_at"), "share_path": f"/share/{row['share_slug']}",
    }


# ---------------------------------------------------------------------------------------------- access
def owned_sermon(session: Session, viewer: Viewer, sermon_id: str, *, lock: bool = False) -> dict[str, Any]:
    """The viewer's own sermon (``lock`` = SELECT ... FOR UPDATE, serialising writers of the same sermon)."""
    if not viewer.user_id:
        raise NotFound("sermon not found")
    row = fetch_one(session, f"SELECT * FROM sermons WHERE id = :id AND user_id = :u{' FOR UPDATE' if lock else ''}", id=sermon_id, u=viewer.user_id)
    if not row:
        raise NotFound("sermon not found")
    return row


def owned_draft(session: Session, sermon_id: str, draft_id: str, *, lock: bool = False) -> dict[str, Any]:
    row = fetch_one(session, f"SELECT * FROM sermon_drafts WHERE id = :id AND sermon_id = :s{' FOR UPDATE' if lock else ''}", id=draft_id, s=sermon_id)
    if not row:
        raise NotFound("draft not found")
    return row


def latest_draft(session: Session, sermon_id: str) -> dict[str, Any] | None:
    return fetch_one(session, "SELECT * FROM sermon_drafts WHERE sermon_id = :s ORDER BY version DESC LIMIT 1", s=sermon_id)


def draft_for(session: Session, sermon_id: str, draft_id: str | None = None) -> dict[str, Any] | None:
    """The given draft (404 when it is not this sermon's) or the latest version (None when nothing was drafted yet)."""
    return owned_draft(session, sermon_id, draft_id) if draft_id else latest_draft(session, sermon_id)


def input_rows(session: Session, sermon_id: str) -> list[dict[str, Any]]:
    return fetch_all(session, "SELECT * FROM sermon_inputs WHERE sermon_id = :s ORDER BY created_at, id", s=sermon_id)


def media_rows(session: Session, sermon_id: str) -> list[dict[str, Any]]:
    return fetch_all(session, "SELECT * FROM sermon_media WHERE sermon_id = :s ORDER BY order_index, created_at, id", s=sermon_id)


def outreach_row(session: Session, sermon_id: str) -> dict[str, Any] | None:
    return fetch_one(session, "SELECT * FROM sermon_outreach WHERE sermon_id = :s", s=sermon_id)


def touch(session: Session, sermon_id: str) -> None:
    execute(session, "UPDATE sermons SET updated_at = now() WHERE id = :id", id=sermon_id)


# ---------------------------------------------------------------------------------------------- CRUD
def clean_title(title: str | None) -> str:
    value = (title or "").strip()
    if len(value) > MAX_TITLE:
        raise ValueError(f"title must be at most {MAX_TITLE} characters")
    return value or DEFAULT_TITLE


def list_sermons(session: Session, viewer: Viewer) -> dict[str, Any]:
    rows = fetch_all(session, """SELECT s.*,
                                        (SELECT count(*) FROM sermon_inputs i WHERE i.sermon_id = s.id) AS input_count,
                                        (SELECT max(d.version) FROM sermon_drafts d WHERE d.sermon_id = s.id) AS draft_version,
                                        (SELECT count(*) FROM sermon_media m WHERE m.sermon_id = s.id) AS media_count,
                                        (SELECT m.storage_key FROM sermon_media m WHERE m.sermon_id = s.id ORDER BY m.order_index, m.created_at, m.id LIMIT 1) AS cover_key,
                                        coalesce((SELECT o.is_public FROM sermon_outreach o WHERE o.sermon_id = s.id), false) AS is_published,
                                        (SELECT o.share_slug FROM sermon_outreach o WHERE o.sermon_id = s.id AND o.is_public) AS public_slug
                                 FROM sermons s WHERE s.user_id = :u ORDER BY s.updated_at DESC, s.id DESC""", u=viewer.user_id)
    return {"items": [
        {**serialize_sermon(r), "input_count": r["input_count"], "draft_version": r["draft_version"], "media_count": r["media_count"],
         "cover_url": storage.signed_url(r["cover_key"]), "is_published": r["is_published"],
         "share_path": f"/share/{r['public_slug']}" if r["public_slug"] else None}
        for r in rows
    ]}


def create_sermon(session: Session, viewer: Viewer, title: str | None = None) -> dict[str, Any]:
    row = fetch_one(session, "INSERT INTO sermons (id, user_id, title) VALUES (:id, :u, :t) RETURNING *",
                    id=new_id("srm"), u=viewer.user_id, t=clean_title(title))
    return serialize_sermon(row)


def sermon_detail(session: Session, viewer: Viewer, sermon_id: str) -> dict[str, Any]:
    sermon = owned_sermon(session, viewer, sermon_id)
    return {
        "sermon": serialize_sermon(sermon),
        "inputs": [serialize_input(r) for r in input_rows(session, sermon_id)],
        "draft": serialize_draft(latest_draft(session, sermon_id)),
        "media": [serialize_media(r) for r in media_rows(session, sermon_id)],
        "outreach": serialize_outreach(outreach_row(session, sermon_id)),
    }


def validate_changes(changes: dict[str, Any]) -> dict[str, Any]:
    """Whitelist + validate sermon edits (unknown keys are ignored; an edit with nothing to change is rejected)."""
    fields = {k: v for k, v in changes.items() if k in EDITABLE_FIELDS}
    if not fields:
        raise ValueError("No updatable fields provided")
    out: dict[str, Any] = {}
    for key, value in fields.items():
        if key in ("scripture_ref", "theme"):
            text = (value or "").strip() if isinstance(value, str) or value is None else None
            if text is None:
                raise ValueError(f"{key} must be text")
            out[key] = text[: 300 if key == "scripture_ref" else 1000] or None
        elif value is None:
            raise ValueError(f"{key} cannot be empty")
        elif key == "title":
            if not isinstance(value, str):
                raise ValueError("title must be text")
            out[key] = clean_title(value)
        elif key == "status" and value not in STATUSES:
            raise ValueError(f"status must be one of: {', '.join(STATUSES)}")
        elif key == "current_stage" and (isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= 4):
            raise ValueError("current_stage must be between 1 and 4")
        elif key == "tone" and value not in TONE_IDS:
            raise ValueError(f"tone must be one of: {', '.join(TONE_IDS)}")
        elif key == "language" and value not in LANGUAGE_CODES:
            raise ValueError(f"language must be one of: {', '.join(LANGUAGE_CODES)}")
        elif key == "export_template" and value not in EXPORT_THEMES:
            raise ValueError(f"export_template must be one of: {', '.join(EXPORT_THEMES)}")
        else:
            out[key] = value
    return out


def update_sermon(session: Session, viewer: Viewer, sermon_id: str, changes: dict[str, Any]) -> dict[str, Any]:
    owned_sermon(session, viewer, sermon_id, lock=True)
    fields = validate_changes(changes)
    sets = ", ".join(f"{k} = :{k}" for k in fields)  # keys come from the EDITABLE_FIELDS whitelist
    row = fetch_one(session, f"UPDATE sermons SET {sets}, updated_at = now() WHERE id = :id RETURNING *", id=sermon_id, **fields)
    return serialize_sermon(row)


def delete_sermon(session: Session, viewer: Viewer, sermon_id: str) -> dict[str, Any]:
    owned_sermon(session, viewer, sermon_id, lock=True)
    execute(session, "DELETE FROM sermons WHERE id = :id", id=sermon_id)  # inputs, drafts, media and outreach cascade
    session.commit()  # the rows are gone for good before their files are removed
    storage.delete_prefix(sermon_prefix(viewer.user_id, sermon_id))
    return {"ok": True}

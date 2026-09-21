"""Sermon writing with Gemini (stage 2 "Polish" and stage 4 "Export & share").

Ports sermon-builder ``app/api/{polish,template,suggestions,speaker-notes,outreach}/route.ts`` and the public share page:
polish the collected inputs into a structured draft (new version), restructure a draft into a sermon format, coaching suggestions,
speaker notes, manual draft edits (sanitised), outreach copy with a share link, publishing and the public share payload.

Grounding: prompts get the exact local text of the pastor's Scripture (VERSE_TEXTS), and English drafts have every ``scripture``
field rewritten as ``"{reference} — {exact text}"``. Untrusted material only ever appears between ``<<<`` and ``>>>``.
No database transaction is held while a model is working: reads are committed first and writes lock the sermon row afterwards.
"""
from __future__ import annotations

import re
import secrets
import string
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

from ... import storage
from ...ai.llm import AIInvalidOutput, get_llm
from ...ai.schemas_sermons import OutreachOut, SpeakerNotesOut, StructuredSermonOut, SuggestionsOut
from ...db import fetch_one, json_dumps
from ...ids import new_id
from ...security import Viewer
from ..bible import NotFound
from . import grounding
from .catalog import DEFAULT_TITLE, LANGUAGE_CODES, STYLE_HINTS, TEMPLATE_STRUCTURES, TEMPLATE_TYPES, TONE_IDS, structure_outline, tone_hint
from .store import (
    input_rows,
    input_text,
    latest_draft,
    media_rows,
    outreach_row,
    owned_draft,
    owned_sermon,
    serialize_draft,
    serialize_outreach,
    serialize_sermon,
    touch,
)
from .structured import draft_text, is_empty, normalize_structured, sanitize_html, structured_to_html
from .visuals import remember_scene_images

POLISH_PER_SOURCE = 8000
POLISH_TOTAL = 24000
FORMAT_SOURCES = 9000
FORMAT_CURRENT = 20000
SUGGESTIONS_CHARS = 4000
NOTES_CHARS = 8000
OUTREACH_CHARS = 3000
MAX_HTML_CHARS = 500_000
MAX_NOTES_CHARS = 50_000
SHARE_SLUG = re.compile(r"[a-z0-9-]{3,80}")


def data(text: str | None) -> str:
    """Untrusted text for a ``<<< >>>`` block: the markers cannot be forged from inside it."""
    return (text or "").replace("<<<", "‹‹‹").replace(">>>", "›››")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _settings(sermon: dict[str, Any], tone: str | None, language: str | None) -> tuple[str, str]:
    tone = tone or sermon["tone"]
    language = language or sermon["language"]
    if tone not in TONE_IDS:
        raise ValueError(f"tone must be one of: {', '.join(TONE_IDS)}")
    if language not in LANGUAGE_CODES:
        raise ValueError(f"language must be one of: {', '.join(LANGUAGE_CODES)}")
    return tone, language


def _sermon_block(sermon: dict[str, Any], content: str) -> str:
    return (f"TITLE: {sermon['title'] or DEFAULT_TITLE}\nSCRIPTURE: {sermon['scripture_ref'] or 'Not specified'}\n"
            f"THEME: {sermon['theme'] or 'Not specified'}\n\nCONTENT:\n{content}")


def _update_sermon(session: Session, sermon_id: str, updates: dict[str, Any]) -> dict[str, Any]:
    sets = "".join(f"{k} = :{k}, " for k in updates)  # keys are fixed column names chosen by this module
    return fetch_one(session, f"UPDATE sermons SET {sets}updated_at = now() WHERE id = :id RETURNING *", id=sermon_id, **updates)


# ---------------------------------------------------------------------------------------------- polish (S-01)
def polish_sources(inputs: list[dict[str, Any]]) -> str:
    """Every input, capped per source and in total, so one long transcript cannot crowd out the rest."""
    parts = [f"[Source {i} - {inp['kind']}]:\n{input_text(inp)[:POLISH_PER_SOURCE]}" for i, inp in enumerate(inputs, start=1)]
    return "\n\n---\n\n".join(parts)[:POLISH_TOTAL]


def polish(session: Session, viewer: Viewer, sermon_id: str, *, tone: str | None = None, language: str | None = None, style: str | None = None) -> dict[str, Any]:
    sermon = owned_sermon(session, viewer, sermon_id)
    tone, language = _settings(sermon, tone, language)
    style = style or "message"
    if style not in TEMPLATE_TYPES:
        raise ValueError(f"style must be one of: {', '.join(TEMPLATE_TYPES)}")
    inputs = input_rows(session, sermon_id)
    if not inputs:
        raise ValueError("Add at least one input (notes, a recording, a document or a Scripture passage) before polishing")
    translation = grounding.preferred_translation(inputs)
    title = sermon["title"] if sermon["title"] and sermon["title"] != DEFAULT_TITLE else "(not set)"
    variables = {
        "style_hint": STYLE_HINTS[style], "style_label": TEMPLATE_STRUCTURES[style]["label"], "tone": tone, "tone_hint": tone_hint(tone), "language": language,
        "details": data(f"WORKING_TITLE: {title}\nSCRIPTURE_FOCUS: {sermon['scripture_ref'] or '(not set)'}\nTHEME: {sermon['theme'] or '(not set)'}"),
        "verse_texts": data(grounding.verse_texts_block(session, sermon["scripture_ref"], inputs, translation)),
        "sources": data(polish_sources(inputs)),
    }
    session.commit()
    result = get_llm().run("S-01", variables, StructuredSermonOut, use_cache=False, run_id=sermon_id)
    structured = normalize_structured(result.output.structured(), sermon["title"] or DEFAULT_TITLE)
    if is_empty(structured):
        raise AIInvalidOutput("The draft came back empty — please try again")
    grounded = grounding.ground_structured(session, structured, language, translation)

    sermon = owned_sermon(session, viewer, sermon_id, lock=True)  # serialises version numbering per sermon
    version = fetch_one(session, "SELECT coalesce(max(version), 0) + 1 AS v FROM sermon_drafts WHERE sermon_id = :s", s=sermon_id)["v"]
    provenance = {**result.provenance(), "action": "polish", "generated_at": _now(), "style": style, "tone": tone, "language": language,
                  "translation": translation, "input_ids": [i["id"] for i in inputs], "grounded": grounded}
    draft = fetch_one(session, """INSERT INTO sermon_drafts (id, sermon_id, version, template_type, structured, polished_html, provenance)
                                  VALUES (:id, :s, :v, :t, CAST(:structured AS jsonb), :html, CAST(:prov AS jsonb)) RETURNING *""",
                      id=new_id("drf"), s=sermon_id, v=version, t=style, structured=json_dumps(structured), html=structured_to_html(structured),
                      prov=json_dumps(provenance))
    updates: dict[str, Any] = {"tone": tone, "language": language}
    if sermon["status"] == "draft":
        updates["status"] = "polished"
    if (sermon["title"] or "").strip() in ("", DEFAULT_TITLE) and structured["title"]:
        updates["title"] = structured["title"][:200]
    if not (sermon["scripture_ref"] or "").strip():
        label = grounding.reference_label(structured["scripture"])
        if label:
            updates["scripture_ref"] = label[:300]
    if not (sermon["theme"] or "").strip() and structured["theme"]:
        updates["theme"] = structured["theme"][:1000]
    return {"draft": serialize_draft(draft), "sermon": serialize_sermon(_update_sermon(session, sermon_id, updates))}


# ---------------------------------------------------------------------------------------------- restructure into a format (S-02)
def format_sources(inputs: list[dict[str, Any]]) -> str:
    parts = [f"[Source {i} · {inp['kind']}]\n{input_text(inp).strip()}" for i, inp in enumerate(inputs, start=1) if input_text(inp).strip()]
    return "\n\n---\n\n".join(parts)[:FORMAT_SOURCES]


def apply_format(session: Session, viewer: Viewer, sermon_id: str, draft_id: str, template_type: str, *, tone: str | None = None,
                 language: str | None = None) -> dict[str, Any]:
    """Re-map the draft (and the original inputs, so nothing is lost) into a format's own outline. Updates the draft in place and
    clears its slide plan (it was designed for the previous structure)."""
    if template_type not in TEMPLATE_TYPES:
        raise ValueError(f"template_type must be one of: {', '.join(TEMPLATE_TYPES)}")
    sermon = owned_sermon(session, viewer, sermon_id)
    draft = owned_draft(session, sermon_id, draft_id)
    tone, language = _settings(sermon, tone, language)
    current_text = draft_text(draft)
    inputs = input_rows(session, sermon_id)
    sources = format_sources(inputs)
    if not current_text.strip() and not sources:
        raise ValueError("Generate the sermon draft first")
    translation = grounding.preferred_translation(inputs)
    structure = TEMPLATE_STRUCTURES[template_type]
    variables = {
        "format_label": structure["label"], "format_summary": structure["summary"], "outline": structure_outline(template_type),
        "tone": tone, "tone_hint": tone_hint(tone), "language": language,
        "verse_texts": data(grounding.verse_texts_block(session, sermon["scripture_ref"], inputs, translation)),
        "sources": data(sources) or "(no raw inputs on file — use the current sermon below as the source)",
        "current_sermon": data(f"TITLE: {(draft.get('structured') or {}).get('title') or sermon['title']}\n\n{current_text[:FORMAT_CURRENT]}"),
    }
    fallback_title = (draft.get("structured") or {}).get("title") or sermon["title"] or DEFAULT_TITLE
    session.commit()
    result = get_llm().run("S-02", variables, StructuredSermonOut, use_cache=False, run_id=sermon_id)
    structured = normalize_structured(result.output.structured(), fallback_title)
    if is_empty(structured):
        raise AIInvalidOutput("The restructured sermon came back empty — please try again")
    grounded = grounding.ground_structured(session, structured, language, translation)

    owned_sermon(session, viewer, sermon_id, lock=True)
    current = owned_draft(session, sermon_id, draft_id, lock=True)
    # the cleared plan's scene images stay available for reuse when the deck is designed again
    previous = current.get("provenance") or {}
    scene_images, evicted = remember_scene_images(previous.get("scene_images"), current.get("slide_plan"))
    provenance = {**{k: v for k, v in previous.items() if k == "speaker_notes"}, **result.provenance(), "action": "format", "generated_at": _now(),
                  "template_type": template_type, "tone": tone, "language": language, "translation": translation, "grounded": grounded,
                  "scene_images": scene_images}
    row = fetch_one(session, """UPDATE sermon_drafts SET structured = CAST(:structured AS jsonb), polished_html = :html, template_type = :t, slide_plan = NULL,
                                       provenance = CAST(:prov AS jsonb), updated_at = now()
                                WHERE id = :id RETURNING *""",
                    structured=json_dumps(structured), html=structured_to_html(structured), t=template_type, prov=json_dumps(provenance), id=draft_id)
    touch(session, sermon_id)
    session.commit()
    for key in evicted:
        storage.delete_key(key)
    return {"draft": serialize_draft(row)}


# ---------------------------------------------------------------------------------------------- coaching suggestions (S-03)
def suggestions(session: Session, viewer: Viewer, sermon_id: str, draft_id: str | None = None) -> dict[str, Any]:
    """Illustrations, applications, cross references, hooks, closing calls and tips for a draft (not stored)."""
    sermon = owned_sermon(session, viewer, sermon_id)
    draft = owned_draft(session, sermon_id, draft_id) if draft_id else latest_draft(session, sermon_id)
    text = draft_text(draft)
    if not text.strip():
        raise ValueError("Generate the sermon draft first")
    translation = grounding.preferred_translation(input_rows(session, sermon_id))
    variables = {"language": sermon["language"], "sermon": data(_sermon_block(sermon, text[:SUGGESTIONS_CHARS]))}
    session.commit()
    out = get_llm().run("S-03", variables, SuggestionsOut, use_cache=False, run_id=sermon_id).output
    connections = []
    for c in out.scripture_connections:
        if not (c.reference or c.connection):
            continue
        verse = None
        if sermon["language"] in grounding.GROUNDED_LANGUAGES:
            rng = grounding.parse_reference(c.reference)
            verse = (grounding.passage_text(session, *rng, translation, max_verses=6) or None) if rng else None
        connections.append({"reference": c.reference, "connection": c.connection, "verse_text": verse})
    return {"suggestions": {
        "illustrations": [{"title": i.name, "description": i.description} for i in out.illustrations if i.name or i.description],
        "applications": [{"point": a.point, "suggestion": a.suggestion} for a in out.applications if a.point or a.suggestion],
        "scripture_connections": connections,
        "opening_hooks": out.opening_hooks, "closing_calls": out.closing_calls, "strengthening_tips": out.strengthening_tips,
    }}


# ---------------------------------------------------------------------------------------------- speaker notes (S-04)
def speaker_notes(session: Session, viewer: Viewer, sermon_id: str, draft_id: str) -> dict[str, Any]:
    sermon = owned_sermon(session, viewer, sermon_id)
    draft = owned_draft(session, sermon_id, draft_id)
    text = draft_text(draft)
    if not text.strip():
        raise ValueError("Generate the sermon draft first")
    variables = {"language": sermon["language"], "sermon": data(_sermon_block(sermon, text[:NOTES_CHARS]))}
    session.commit()
    result = get_llm().run("S-04", variables, SpeakerNotesOut, use_cache=False, run_id=sermon_id)
    notes = result.output.notes.strip()
    if not notes:
        raise AIInvalidOutput("The speaker notes came back empty — please try again")
    owned_sermon(session, viewer, sermon_id, lock=True)
    current = owned_draft(session, sermon_id, draft_id, lock=True)
    provenance = {**(current.get("provenance") or {}), "speaker_notes": {**result.provenance(), "generated_at": _now()}}
    row = fetch_one(session, "UPDATE sermon_drafts SET speaker_notes = :n, provenance = CAST(:prov AS jsonb), updated_at = now() WHERE id = :id RETURNING *",
                    n=notes, prov=json_dumps(provenance), id=draft_id)
    touch(session, sermon_id)
    return {"notes": notes, "draft": serialize_draft(row)}


# ---------------------------------------------------------------------------------------------- manual edits
def update_draft(session: Session, viewer: Viewer, sermon_id: str, draft_id: str, changes: dict[str, Any]) -> dict[str, Any]:
    """Editor saves: ``polished_html`` is sanitised with an allow-list, ``structured`` is normalised (and re-rendered to HTML when no
    HTML accompanies it), ``speaker_notes`` is plain text."""
    sermon = owned_sermon(session, viewer, sermon_id, lock=True)
    draft = owned_draft(session, sermon_id, draft_id, lock=True)
    sets: list[str] = []
    params: dict[str, Any] = {"id": draft_id}
    if changes.get("structured") is not None:
        structured = normalize_structured(changes["structured"], (draft.get("structured") or {}).get("title") or sermon["title"] or DEFAULT_TITLE)
        sets.append("structured = CAST(:structured AS jsonb)")
        params["structured"] = json_dumps(structured)
        if "polished_html" not in changes:
            sets.append("polished_html = :html")
            params["html"] = structured_to_html(structured)
    if "polished_html" in changes:
        html = changes["polished_html"] or ""
        if len(html) > MAX_HTML_CHARS:
            raise ValueError("the sermon HTML is too large")
        sets.append("polished_html = :html")
        params["html"] = sanitize_html(html)
    if "speaker_notes" in changes:
        notes = (changes["speaker_notes"] or "").strip()
        if len(notes) > MAX_NOTES_CHARS:
            raise ValueError(f"speaker notes must be at most {MAX_NOTES_CHARS:,} characters")
        sets.append("speaker_notes = :notes")
        params["notes"] = notes or None
    if not sets:
        raise ValueError("No updatable fields provided")
    row = fetch_one(session, f"UPDATE sermon_drafts SET {', '.join(sets)}, updated_at = now() WHERE id = :id RETURNING *", **params)
    touch(session, sermon_id)
    return serialize_draft(row)


# ---------------------------------------------------------------------------------------------- outreach + sharing (S-07)
def share_slug(title: str | None) -> str:
    """``the-good-shepherd-k3v9x0q2ab``: slugified title (<= 40 chars) + 10 random lowercase letters/digits."""
    base = re.sub(r"[^a-z0-9]+", "-", (title or "").lower()).strip("-")[:40].strip("-") or "sermon"
    return f"{base}-{''.join(secrets.choice(string.ascii_lowercase + string.digits) for _ in range(10))}"


def clean_hashtags(tags: list[str], limit: int = 10) -> list[str]:
    """Bare hashtag words (the UI adds '#'), de-duplicated case-insensitively."""
    out: list[str] = []
    for tag in tags:
        word = re.sub(r"[^\w]", "", tag or "")
        if word and word.lower() not in {t.lower() for t in out}:
            out.append(word[:60])
    return out[:limit]


def generate_outreach(session: Session, viewer: Viewer, sermon_id: str) -> dict[str, Any]:
    """Summary, social caption, hashtags and platform posts. The share link (slug) is created once and kept on regeneration."""
    sermon = owned_sermon(session, viewer, sermon_id)
    content = draft_text(latest_draft(session, sermon_id))
    if not content.strip():
        content = "\n\n".join(t for t in (input_text(i).strip() for i in input_rows(session, sermon_id)) if t)
    if not content.strip():
        raise ValueError("Add some content or generate the sermon draft first")
    variables = {"language": sermon["language"], "sermon": data(_sermon_block(sermon, content[:OUTREACH_CHARS]))}
    session.commit()
    result = get_llm().run("S-07", variables, OutreachOut, use_cache=False, run_id=sermon_id)
    out = result.output
    if not out.summary or not out.social_caption:
        raise AIInvalidOutput("The outreach content came back empty — please try again")
    hashtags = clean_hashtags(out.hashtags)
    social = {"instagram_caption": out.instagram_caption, "facebook_post": out.facebook_post, "twitter_thread": out.twitter_thread}
    sermon = owned_sermon(session, viewer, sermon_id, lock=True)
    existing = outreach_row(session, sermon_id)
    row = fetch_one(session, """INSERT INTO sermon_outreach (id, sermon_id, share_slug, summary, social_caption, hashtags, social)
                                VALUES (:id, :s, :slug, :summary, :caption, CAST(:tags AS text[]), CAST(:social AS jsonb))
                                ON CONFLICT (sermon_id) DO UPDATE SET summary = EXCLUDED.summary, social_caption = EXCLUDED.social_caption,
                                    hashtags = EXCLUDED.hashtags, social = EXCLUDED.social, updated_at = now()
                                RETURNING *""",
                    id=new_id("out"), s=sermon_id, slug=existing["share_slug"] if existing else share_slug(sermon["title"]), summary=out.summary,
                    caption=out.social_caption, tags=hashtags, social=json_dumps(social))
    touch(session, sermon_id)
    return {"outreach": serialize_outreach(row), "social": {"summary": out.summary, "social_caption": out.social_caption, "hashtags": hashtags, **social}}


def set_outreach_visibility(session: Session, viewer: Viewer, sermon_id: str, is_public: bool) -> dict[str, Any]:
    """Publish (public share page, status 'published') or unpublish (status 'exported')."""
    owned_sermon(session, viewer, sermon_id, lock=True)
    row = fetch_one(session, """UPDATE sermon_outreach
                                SET published_at = CASE WHEN CAST(:pub AS boolean) AND (NOT is_public OR published_at IS NULL) THEN now() ELSE published_at END,
                                    is_public = CAST(:pub AS boolean), updated_at = now()
                                WHERE sermon_id = :s RETURNING *""", pub=bool(is_public), s=sermon_id)
    if not row:
        raise ValueError("Generate the outreach content first")
    sermon = _update_sermon(session, sermon_id, {"status": "published" if is_public else "exported"})
    return {"outreach": serialize_outreach(row), "sermon": serialize_sermon(sermon)}


def share_page(session: Session, slug: str) -> dict[str, Any]:
    """Public payload of a published sermon (404 for unknown, unpublished or malformed slugs)."""
    if not SHARE_SLUG.fullmatch(slug or ""):
        raise NotFound("page not found")
    post = fetch_one(session, """SELECT o.*, s.title, s.scripture_ref, s.theme, s.language, u.display_name, u.church
                                 FROM sermon_outreach o JOIN sermons s ON s.id = o.sermon_id JOIN users u ON u.id = s.user_id
                                 WHERE o.share_slug = :slug AND o.is_public AND u.is_active""", slug=slug)
    if not post:
        raise NotFound("page not found")
    draft = latest_draft(session, post["sermon_id"])
    structured = normalize_structured(draft["structured"], post["title"]) if draft and draft.get("structured") else None
    if draft and draft.get("polished_html"):
        html = sanitize_html(draft["polished_html"])
    else:
        html = structured_to_html(structured) if structured else ""
    return {
        "title": post["title"], "scripture_ref": post["scripture_ref"], "theme": post["theme"], "language": post["language"],
        "author": {"display_name": post["display_name"], "church": post["church"]}, "published_at": post["published_at"],
        "summary": post["summary"], "social_caption": post["social_caption"], "hashtags": list(post["hashtags"] or []),
        "html": html, "structured": structured,
        "media": [{"url": storage.signed_url(m["storage_key"]), "caption": m["caption"], "kind": m["kind"]} for m in media_rows(session, post["sermon_id"])],
    }

"""Helpers shared by the test modules (importable as ``tests.support``).

conftest.py configures settings (test database, temp storage, no AI) before this module's
functions are used; nothing here opens a session at import time.
"""
from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Any

from interactive_bible import cache, security
from interactive_bible.db import execute, fetch_all, fetch_one, session_scope

ADMIN, EDITOR, MEMBER, OUTSIDER = "admin@interactivebible.local", "editor@interactivebible.local", "member@interactivebible.local", "outsider@interactivebible.local"
MUTABLE_TABLES = ("resources", "jobs", "processing_runs", "llm_calls", "llm_cache", "review_actions", "feedback",
                  "analytics_events", "search_logs", "worker_heartbeats", "sermons", "explore_stories", "explore_event_cards")
DEMO_USER_IDS = ["usr_admin", "usr_editor", "usr_member", "usr_outsider"]
VISIBLE = ("published", "approved")


# ----------------------------------------------------------------------------- state
def reset_mutable_state() -> None:
    """Truncate everything tests create; never bible_*, users, organizations, topics or entities."""
    with session_scope() as s:
        execute(s, f"TRUNCATE {', '.join(MUTABLE_TABLES)} RESTART IDENTITY CASCADE")
        execute(s, "DELETE FROM verse_relationships WHERE source <> 'openbible'")
        # P-09 explanations are written onto corpus cross-reference rows: restore them (rows themselves are kept)
        execute(s, """UPDATE verse_relationships SET explanation = NULL, explanation_confidence = NULL, explanation_provenance = NULL
                      WHERE source = 'openbible' AND (explanation IS NOT NULL OR explanation_confidence IS NOT NULL OR explanation_provenance IS NOT NULL)""")
        # curated topic -> key verse index is vocabulary seed data (seed_vocabulary); everything else is derived by tests
        execute(s, "DELETE FROM verse_topics WHERE provenance->>'source' IS DISTINCT FROM 'curated_topic_index'")
        execute(s, "DELETE FROM verse_entities")
        execute(s, "DELETE FROM verse_embeddings WHERE content_hash = :h", h=FAKE_EMBEDDING_HASH)
        # accounts created by sign-up tests; demo accounts keep their seeded state (profile tests restore passwords themselves)
        execute(s, "DELETE FROM users WHERE id <> ALL(:ids)", ids=DEMO_USER_IDS)
        execute(s, "UPDATE users SET church = NULL WHERE church IS NOT NULL")
    clear_process_state()


FAKE_EMBEDDING_HASH = "pytest-fake-embedding"


def insert_fake_verse_embeddings(verse_ids: list[int], seed: int = 7) -> None:
    """Give a handful of verses random unit vectors so pgvector retrieval returns them (removed by reset_mutable_state)."""
    import numpy as np

    from interactive_bible.config import get_settings
    from interactive_bible.retrieval.semantic import vector_literal

    settings = get_settings()
    rng = np.random.default_rng(seed)
    with session_scope() as s:
        for vid in verse_ids:
            vec = rng.standard_normal(settings.embedding_dim)
            execute(s, """INSERT INTO verse_embeddings (verse_id, model, translation_id, content_hash, embedding)
                          VALUES (:v, :m, 'web', :h, CAST(:e AS vector)) ON CONFLICT (verse_id, model) DO NOTHING""",
                    v=vid, m=settings.gemini_embed_model, h=FAKE_EMBEDDING_HASH, e=vector_literal((vec / np.linalg.norm(vec)).tolist()))


def clear_process_state() -> None:
    cache.intelligence_cache.clear()
    cache.search_cache.clear()
    cache.chapter_cache.clear()
    with security.rate_limiter._lock:
        security.rate_limiter._hits.clear()


# ----------------------------------------------------------------------------- auth
def user_row(email: str) -> dict[str, Any]:
    with session_scope() as s:
        row = fetch_one(s, "SELECT * FROM users WHERE email = :e", e=email)
    assert row, f"demo user {email} missing"
    return row


def auth_headers(email: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {security.issue_token(user_row(email))}"}


# ----------------------------------------------------------------------------- resources
def create_resource(client, headers: dict[str, str], **fields: Any) -> dict[str, Any]:
    body = {"type": "native", "title": "Test resource", "visibility": "public", "rights_status": "owned", **fields}
    resp = client.post("/v1/resources", json=body, headers=headers)
    assert resp.status_code == 201, resp.text
    return resp.json()


def upload(client, headers: dict[str, str], resource_id: str, path_or_bytes: Path | bytes, filename: str, kind: str = "source"):
    data = path_or_bytes.read_bytes() if isinstance(path_or_bytes, Path) else path_or_bytes
    return client.post(f"/v1/resources/{resource_id}/upload", files={"file": (filename, data, "application/octet-stream")}, data={"kind": kind}, headers=headers)


def process_now(resource_id: str, options: dict[str, Any] | None = None, triggered_by: str | None = None) -> dict[str, Any]:
    """Create a run and execute the whole pipeline synchronously (no worker)."""
    from interactive_bible.pipeline.orchestrator import create_run, process_resource

    with session_scope() as s:
        run_id = create_run(s, resource_id, triggered_by, dict(options or {}))
    return process_resource(resource_id, run_id, dict(options or {}))


def run_worker_once(queues: tuple[str, ...] = ("pipeline", "media", "ai", "embeddings", "default")) -> bool:
    from interactive_bible.worker import Worker

    return Worker(list(queues), worker_id="pytest-worker").run_once()


def api_process(client, headers: dict[str, str], resource_id: str, **options: Any) -> dict[str, Any]:
    """POST /process then let a worker execute the queued job; returns the run row."""
    resp = client.post(f"/v1/resources/{resource_id}/process", json=options or None, headers=headers)
    assert resp.status_code == 200, resp.text
    queued = resp.json()
    assert run_worker_once(("pipeline",)), "no pipeline job was queued"
    with session_scope() as s:
        return fetch_one(s, "SELECT * FROM processing_runs WHERE id = :id", id=queued["run_id"])


def links_for(resource_id: str, parents_only: bool = True) -> list[dict[str, Any]]:
    with session_scope() as s:
        return fetch_all(s, f"""SELECT l.*, v.canonical_ref FROM verse_resource_links l JOIN bible_verses v ON v.id = l.verse_id
                                WHERE l.resource_id = :r {'AND l.parent_link_id IS NULL' if parents_only else ''}
                                ORDER BY l.verse_id, l.end_verse_id NULLS FIRST""", r=resource_id)


def link_by_ref(resource_id: str, canonical: str) -> dict[str, Any] | None:
    """Parent mapping whose canonical range string equals ``canonical`` (e.g. 'ROM.8.28' or 'JAS.1.2-JAS.1.4')."""
    from interactive_bible.bible import books as B

    for link in links_for(resource_id):
        if B.canonical_range_str(link["verse_id"], link["end_verse_id"]) == canonical:
            return link
    return None


def refs(links: list[dict[str, Any]], statuses: tuple[str, ...] | None = None) -> set[str]:
    from interactive_bible.bible import books as B

    return {B.canonical_range_str(l["verse_id"], l["end_verse_id"]) for l in links if statuses is None or l["review_status"] in statuses}


def sql(query: str, **params: Any) -> list[dict[str, Any]]:
    with session_scope() as s:
        return fetch_all(s, query, **params)


def sql_one(query: str, **params: Any) -> dict[str, Any] | None:
    with session_scope() as s:
        return fetch_one(s, query, **params)


def sql_exec(query: str, **params: Any) -> None:
    with session_scope() as s:
        execute(s, query, **params)


# ----------------------------------------------------------------------------- media
def make_silent_audio(path: Path, seconds: int = 20) -> Path:
    if not path.exists():
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "anullsrc=r=16000:cl=mono", "-t", str(seconds), "-q:a", "9", str(path)],
                       check=True, capture_output=True, timeout=120)
    return path


def vtt(cues: list[tuple[float, float, str]]) -> bytes:
    def ts(seconds: float) -> str:
        ms = int(round(seconds * 1000))
        return f"{ms // 3_600_000:02d}:{(ms // 60_000) % 60:02d}:{(ms // 1000) % 60:02d}.{ms % 1000:03d}"

    lines = ["WEBVTT", ""]
    for start, end, text in cues:
        lines += [f"{ts(start)} --> {ts(end)}", text, ""]
    return "\n".join(lines).encode("utf-8")

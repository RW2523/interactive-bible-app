"""Bible verse embedding index (spec §11.2): resumable, rate-limited batches via Gemini embeddings."""
from __future__ import annotations

import logging
from typing import Any

from .. import jobs
from ..ai.llm import AIUnavailable, get_llm
from ..config import get_settings
from ..db import execute, fetch_all, fetch_one, session_scope
from ..ids import sha256_text
from ..retrieval.semantic import vector_literal

log = logging.getLogger(__name__)
BATCH = 100


def embedding_progress() -> dict[str, Any]:
    s = get_settings()
    with session_scope() as session:
        total = fetch_one(session, "SELECT count(DISTINCT verse_id) AS n FROM bible_verse_texts WHERE translation_id = :t", t=s.default_translation)["n"]
        done = fetch_one(session, "SELECT count(*) AS n FROM verse_embeddings WHERE model = :m", m=s.gemini_embed_model)["n"]
        job = fetch_one(session, "SELECT id, status, attempts, last_error, updated_at FROM jobs WHERE type = 'embed_bible' ORDER BY created_at DESC LIMIT 1")
    return {"model": s.gemini_embed_model, "dimensions": s.embedding_dim, "embedded": done, "total": total, "complete": total > 0 and done >= total, "job": job}


def embed_bible_batch(max_batches: int = 20) -> dict[str, Any]:
    s = get_settings()
    llm = get_llm()
    if not llm.available:
        return {"stopped": True, "reason": "AI not configured", "remaining": 0}
    embedded = 0
    for _ in range(max_batches):
        with session_scope() as session:
            rows = fetch_all(session, """SELECT t.verse_id, v.canonical_ref, t.text FROM bible_verse_texts t JOIN bible_verses v ON v.id = t.verse_id
                                         WHERE t.translation_id = :t AND NOT EXISTS (SELECT 1 FROM verse_embeddings e WHERE e.verse_id = t.verse_id AND e.model = :m)
                                         ORDER BY t.verse_id LIMIT :n""", t=s.default_translation, m=s.gemini_embed_model, n=BATCH)
        if not rows:
            break
        try:
            vectors, model = llm.embed([r["text"] for r in rows], "RETRIEVAL_DOCUMENT")
        except AIUnavailable as exc:
            log.warning("verse embedding paused: %s", exc)
            progress = embedding_progress()
            return {"stopped": "budget" in str(exc) or "not configured" in str(exc), "error": str(exc)[:300], "embedded_now": embedded, "remaining": progress["total"] - progress["embedded"]}
        with session_scope() as session:
            for r, vec in zip(rows, vectors):
                execute(session, """INSERT INTO verse_embeddings (verse_id, model, translation_id, content_hash, embedding) VALUES (:v, :m, :t, :h, CAST(:e AS vector))
                                    ON CONFLICT (verse_id, model) DO NOTHING""", v=r["verse_id"], m=s.gemini_embed_model, t=s.default_translation, h=sha256_text(r["text"]), e=vector_literal(vec))
        embedded += len(rows)
    progress = embedding_progress()
    return {"embedded_now": embedded, "remaining": max(0, progress["total"] - progress["embedded"]), "progress": progress}


def ensure_embedding_job() -> str | None:
    if not get_llm().available:
        return None
    progress = embedding_progress()
    if progress["complete"]:
        return None
    with session_scope() as session:
        return jobs.enqueue(session, "embed_bible", {"max_batches": 20}, dedupe_key="embed_bible", priority=200, max_attempts=10)

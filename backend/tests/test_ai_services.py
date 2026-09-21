"""AI-backed services outside the ingestion pipeline, with the fake client: verse enrichment job (P-15 themes, P-09
explanations), clip caption copy (P-13), Bible verse embedding batches, and Ask AI rate limiting."""
from __future__ import annotations

import pytest

from interactive_bible.config import get_settings

from .support import EDITOR, MEMBER, auth_headers, create_resource, link_by_ref, process_now, run_worker_once, sql, sql_exec, sql_one


def _uncurated_verse_with_cross_references() -> tuple[int, str]:
    from interactive_bible.bible import books as B

    row = sql_one("""SELECT r.from_verse_id AS v FROM verse_relationships r
                     WHERE r.source = 'openbible' AND r.from_end_verse_id IS NULL
                       AND NOT EXISTS (SELECT 1 FROM verse_topics t WHERE t.verse_id = r.from_verse_id)
                     GROUP BY r.from_verse_id HAVING count(*) >= 6 ORDER BY r.from_verse_id LIMIT 1""")
    return row["v"], B.ref_from_ordinal(row["v"])


def test_verse_intelligence_enqueues_enrichment_and_worker_applies_it(client, fake_llm):
    verse_id, ref = _uncurated_verse_with_cross_references()
    first = client.get(f"/v1/verses/{ref}/intelligence").json()
    assert first["ai_available"] is True and first["themes"] == []
    jobs = sql("SELECT type, queue, status, dedupe_key FROM jobs")
    assert jobs == [{"type": "enrich_verse", "queue": "ai", "status": "queued", "dedupe_key": f"enrich:{verse_id}"}]
    client.get(f"/v1/verses/{ref}/intelligence")
    assert sql_one("SELECT count(*) AS n FROM jobs")["n"] == 1  # de-duplicated while queued

    assert run_worker_once(("ai",))
    job = sql_one("SELECT status, result FROM jobs")
    assert job["status"] == "succeeded" and job["result"]["themes"] == 1 and job["result"]["explained"] >= 1
    topic = sql_one("SELECT topic_id, confidence, provenance FROM verse_topics WHERE verse_id = :v", v=verse_id)
    assert topic["topic_id"] == "topic_hope" and topic["provenance"]["source"] == "ai_verse_tagger" and topic["provenance"]["prompt_id"] == "P-15"
    explained = sql("SELECT explanation, explanation_provenance FROM verse_relationships WHERE from_verse_id = :v AND explanation IS NOT NULL", v=verse_id)
    assert explained and all(r["explanation_provenance"]["prompt_id"] == "P-09" for r in explained)

    after = client.get(f"/v1/verses/{ref}/intelligence").json()
    assert after["provenance"]["cache"] == "miss"
    assert [t["slug"] for t in after["themes"]] == ["hope"] and after["themes"][0]["sources"] == ["ai_verse_tagger"]
    ready = [r for r in after["related_verses"] if r["why_status"] == "ready"]
    assert ready and ready[0]["why"] == "Both passages speak about God's faithful care for his people."


def test_curated_topic_index_themes_need_no_ai(client, no_llm):
    body = client.get("/v1/verses/ROM.8.28/intelligence").json()
    curated = [t for t in body["themes"] if "curated_topic_index" in t["sources"]]
    assert curated and all(t["confidence"] == pytest.approx(0.85) for t in curated)
    assert sql("SELECT type FROM jobs") == []  # nothing to enrich without AI


def test_reseeding_vocabulary_restores_curated_topics_shadowed_by_derived_rows(no_llm):
    from interactive_bible.db import session_scope
    from interactive_bible.vocab.service import seed_vocabulary

    row = "SELECT confidence, provenance->>'source' AS source FROM verse_topics WHERE verse_id = 45008028 AND topic_id = 'topic_providence'"
    sql_exec("DELETE FROM verse_topics WHERE verse_id = 45008028 AND topic_id = 'topic_providence'")
    sql_exec("""INSERT INTO verse_topics (verse_id, topic_id, confidence, provenance) VALUES (45008028, 'topic_providence', 0.9, '{"source": "ai_verse_tagger"}')""")
    with session_scope() as s:
        seed_vocabulary(s)
    assert sql(row) == [{"confidence": pytest.approx(0.85), "source": "curated_topic_index"}]


def test_caption_copy_is_generated_and_quotes_are_validated(client, login, fake_llm):
    rid = create_resource(client, login(EDITOR), type="native", title="Caption source", body_text="Romans 8:28 tells us God works in every season.")["id"]
    process_now(rid)
    seg = link_by_ref(rid, "ROM.8.28")["segment_id"]
    fake_llm.on("P-13", {"hook": "“God works in every season”", "verse_label": "Romans 8:28",
                         "caption_lines": ["“God never lets us suffer”", "Hope for today"], "description": "A reminder of God's care."})
    body = client.post(f"/v1/admin/clips/{seg}/caption", headers=login(EDITOR)).json()
    assert body["hook"] == "“God works in every season”" and body["provenance"]["prompt_id"] == "P-13"
    assert body["validation_issues"] == ["quoted text not found in source: God never lets us suffer"]
    stored = sql_one("SELECT caption_copy FROM resource_segments WHERE id = :s", s=seg)["caption_copy"]
    assert stored["verse_label"] == "Romans 8:28" and stored["validation_issues"] == body["validation_issues"]
    assert sql_one("SELECT action FROM review_actions WHERE object_id = :s", s=seg)["action"] == "caption_generated"
    assert client.get(f"/v1/clips/{seg}").json()["caption_copy"]["hook"] == body["hook"]
    prompt = fake_llm.calls_for("P-13")[0]
    assert "We know that all things work together" in prompt.section("VERSE_TEXT")


def test_caption_copy_requires_ai_and_a_visible_mapping(client, login, no_llm):
    rid = create_resource(client, login(EDITOR), type="native", title="No AI captions", body_text="Romans 8:28 tells us God works in every season.")["id"]
    process_now(rid)
    seg = link_by_ref(rid, "ROM.8.28")["segment_id"]
    resp = client.post(f"/v1/admin/clips/{seg}/caption", headers=login(EDITOR))
    assert resp.status_code == 403 and "caption generation unavailable" in resp.json()["detail"]
    sql_exec("UPDATE verse_resource_links SET review_status = 'rejected' WHERE segment_id = :s", s=seg)
    resp = client.post(f"/v1/admin/clips/{seg}/caption", headers=login(EDITOR))
    assert resp.status_code == 403 and "approved or published mapping" in resp.json()["detail"]


def test_bible_embedding_batches_are_resumable(fake_llm):
    from interactive_bible.services.embeddings import embed_bible_batch, embedding_progress, ensure_embedding_job

    settings = get_settings()

    def embedded() -> set[int]:
        return {r["verse_id"] for r in sql("SELECT verse_id FROM verse_embeddings WHERE model = :m", m=settings.gemini_embed_model)}

    before = embedded()
    try:
        progress = embedding_progress()
        assert progress["total"] == 31098 and progress["complete"] is False
        result = embed_bible_batch(max_batches=1)
        new = sorted(embedded() - before)
        assert result["embedded_now"] == 100 and len(new) == 100 and result["remaining"] == 31098 - len(before) - 100
        first = new[0]
        norm = sql_one("SELECT vector_norm(embedding) AS n FROM verse_embeddings WHERE verse_id = :v AND model = :m", v=first, m=settings.gemini_embed_model)["n"]
        assert norm == pytest.approx(1.0, abs=1e-5)
        assert fake_llm.embed_calls[0][2] == "RETRIEVAL_DOCUMENT" and fake_llm.embed_calls[0][3] == settings.embedding_dim
        second = embed_bible_batch(max_batches=1)
        assert second["embedded_now"] == 100 and len(fake_llm.embed_calls) == 2
        assert min(embedded() - before - set(new)) > new[-1]  # resumable: continues in verse order
        job_id = ensure_embedding_job()
        assert job_id and sql_one("SELECT type, queue, priority, max_attempts FROM jobs WHERE id = :id", id=job_id) == {"type": "embed_bible", "queue": "embeddings", "priority": 200, "max_attempts": 10}
        assert ensure_embedding_job() == job_id
    finally:
        sql_exec("DELETE FROM verse_embeddings WHERE model = :m AND verse_id = ANY(:ids)", m=settings.gemini_embed_model, ids=sorted(embedded() - before))


def test_embedding_batch_stops_cleanly_without_ai(no_llm):
    from interactive_bible.services.embeddings import embed_bible_batch, ensure_embedding_job

    assert embed_bible_batch(max_batches=1) == {"stopped": True, "reason": "AI not configured", "remaining": 0}
    assert ensure_embedding_job() is None


def test_ask_is_rate_limited_per_client(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "ask_rate_limit_per_minute", 2)
    body = {"ref": "ROM.8.28", "question": "What does this mean?"}
    statuses = [client.post("/v1/ask", json=body, headers=auth_headers(MEMBER)).status_code for _ in range(3)]
    assert statuses == [403, 403, 429]  # no AI configured: refused, then rate limited
    assert client.post("/v1/ask", json=body, headers=auth_headers(EDITOR)).status_code == 403  # limits are per user

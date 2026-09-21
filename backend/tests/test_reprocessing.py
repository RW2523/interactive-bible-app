"""Reprocessing safety: human decisions survive (AC-09, REV-05) and failed stages retry without duplicates (AC-12)."""
from __future__ import annotations

import pytest

from interactive_bible.pipeline import detectors, orchestrator

from .support import (
    EDITOR,
    MEMBER,
    api_process,
    create_resource,
    link_by_ref,
    links_for,
    process_now,
    refs,
    run_worker_once,
    sql,
    sql_exec,
    sql_one,
)

DOC = ("# Hope in hard seasons\n\n"
       "We are reading Romans 8:28 this morning. Now look at verse thirty-one: if God is for us, who can be against us? "
       "Questions? Write to pastor.ann@example.org.\n\n"
       "# Grief\n\n"
       "At the graveside of his friend, Jesus wept. Grief is not a lack of faith.")


def doc_resource(client, login, owner=EDITOR, text=DOC, title="Reprocessing doc") -> str:
    return create_resource(client, login(owner), type="native", title=title, body_text=text)["id"]


def duplicate_keys(resource_id: str) -> list[dict]:
    return sql("""SELECT segment_id, verse_id, coalesce(end_verse_id, verse_id) AS end_id, count(*) AS n FROM verse_resource_links
                  WHERE resource_id = :r GROUP BY 1, 2, 3 HAVING count(*) > 1""", r=resource_id)


def counts(resource_id: str) -> dict:
    return sql_one("""SELECT (SELECT count(*) FROM resource_segments WHERE resource_id = :r) AS segments,
                             (SELECT count(*) FROM resource_segments WHERE resource_id = :r AND is_active) AS active_segments,
                             (SELECT count(*) FROM verse_resource_links WHERE resource_id = :r) AS links,
                             (SELECT count(*) FROM verse_resource_links WHERE resource_id = :r AND parent_link_id IS NULL) AS parent_links,
                             (SELECT count(*) FROM resource_transcripts WHERE resource_id = :r) AS transcripts""", r=resource_id)


# ----------------------------------------------------------------------------- AC-09
def test_ac09_human_approved_and_rejected_mappings_survive_reprocessing(client, login):
    """AC-09 Human-approved and human-rejected mappings survive reprocessing and a rejected mapping is not re-added."""
    rid = doc_resource(client, login)
    first = api_process(client, login(EDITOR), rid)
    assert first["status"] == "succeeded"
    assert refs(links_for(rid)) == {"ROM.8.28", "ROM.8.31", "JHN.11.35"}
    approved, rejected = link_by_ref(rid, "ROM.8.31"), link_by_ref(rid, "JHN.11.35")
    auto = link_by_ref(rid, "ROM.8.28")
    assert client.post(f"/v1/admin/mappings/{approved['id']}/approve", headers=login(EDITOR)).status_code == 200
    assert client.delete(f"/v1/admin/mappings/{rejected['id']}", params={"note": "a quote about grief, not a citation"}, headers=login(EDITOR)).json()["review_status"] == "rejected"

    second = api_process(client, login(EDITOR), rid)
    assert second["status"] == "succeeded" and second["id"] != first["id"]
    after_approved, after_rejected = link_by_ref(rid, "ROM.8.31"), link_by_ref(rid, "JHN.11.35")
    assert after_approved["id"] == approved["id"] and after_approved["review_status"] == "approved" and after_approved["is_human_verified"]
    assert after_rejected["id"] == rejected["id"] and after_rejected["review_status"] == "rejected"
    assert after_approved["processing_run_id"] == first["id"]  # untouched by the new run
    regenerated = link_by_ref(rid, "ROM.8.28")
    assert regenerated["id"] != auto["id"] and regenerated["processing_run_id"] == second["id"] and regenerated["review_status"] == "published"
    assert len([l for l in links_for(rid) if l["verse_id"] == rejected["verse_id"]]) == 1  # not re-added
    assert duplicate_keys(rid) == []
    assert rid not in {c["resource"]["id"] for c in client.get("/v1/verses/JHN.11.35/intelligence").json()["top_resources"]}
    assert rid in {c["resource"]["id"] for c in client.get("/v1/verses/ROM.8.31/intelligence").json()["top_resources"]}

    # the same holds for direct orchestrator runs (CLI / seed)
    process_now(rid)
    assert link_by_ref(rid, "ROM.8.31")["id"] == approved["id"] and link_by_ref(rid, "JHN.11.35")["review_status"] == "rejected"


def test_ac09_reset_human_removes_human_decisions(client, login):
    """AC-09 The explicit reset_human option removes human decisions before reprocessing (editors only)."""
    rid = doc_resource(client, login, owner=MEMBER)
    process_now(rid)
    rejected = link_by_ref(rid, "JHN.11.35")
    approved = link_by_ref(rid, "ROM.8.31")
    client.delete(f"/v1/admin/mappings/{rejected['id']}", headers=login(EDITOR))
    client.post(f"/v1/admin/mappings/{approved['id']}/approve", headers=login(EDITOR))

    denied = client.post(f"/v1/resources/{rid}/process", json={"reset_human": True}, headers=login(MEMBER))
    assert denied.status_code == 403
    run = api_process(client, login(EDITOR), rid, reset_human=True)
    assert run["status"] == "succeeded" and run["options"]["reset_human"] is True
    readded, reset = link_by_ref(rid, "JHN.11.35"), link_by_ref(rid, "ROM.8.31")
    assert readded["id"] != rejected["id"] and readded["review_status"] == "published" and not readded["is_human_verified"]
    assert reset["id"] != approved["id"] and not reset["is_human_verified"] and reset["review_status"] == "published"
    action = sql_one("SELECT reviewer_id, previous_value FROM review_actions WHERE action = 'reset_mappings' AND object_id = :r", r=rid)
    assert action == {"reviewer_id": "usr_editor", "previous_value": {"deleted_links": 3}}


def test_ac09_concurrent_process_requests_are_not_duplicated(client, login):
    """AC-09 Repeated process requests reuse the active run unless forced."""
    rid = doc_resource(client, login)
    first = client.post(f"/v1/resources/{rid}/process", headers=login(EDITOR)).json()
    again = client.post(f"/v1/resources/{rid}/process", headers=login(EDITOR)).json()
    assert again == {"run_id": first["run_id"], "status": "already_queued", "job_id": None}
    forced = client.post(f"/v1/resources/{rid}/process", json={"force": True}, headers=login(EDITOR)).json()
    assert forced["run_id"] != first["run_id"] and forced["status"] == "queued"


def test_rev05_protected_links_migrate_when_segments_change(client, login):
    """REV-05 When reprocessing changes segment boundaries/text, human decisions move to the best-overlapping new segment."""
    rid = doc_resource(client, login)
    process_now(rid)
    approved = link_by_ref(rid, "ROM.8.31")
    old_segment = approved["segment_id"]
    client.post(f"/v1/admin/mappings/{approved['id']}/approve", headers=login(EDITOR))
    assert "[email]" in sql_one("SELECT text_normalized FROM resource_segments WHERE id = :s", s=old_segment)["text_normalized"]

    # turning PII redaction off changes the source hash -> new transcript -> new content-addressed segment ids
    assert client.patch(f"/v1/resources/{rid}", json={"pii_redaction": False}, headers=login(EDITOR)).status_code == 200
    process_now(rid)
    moved = link_by_ref(rid, "ROM.8.31")
    assert moved["id"] == approved["id"] and moved["review_status"] == "approved"
    assert moved["segment_id"] != old_segment and moved["provenance"]["migrated_from_segment"] == old_segment
    new_text = sql_one("SELECT text_normalized FROM resource_segments WHERE id = :s", s=moved["segment_id"])["text_normalized"]
    assert "pastor.ann@example.org" in new_text
    assert sql_one("SELECT id FROM resource_segments WHERE id = :s", s=old_segment) is None  # nothing protected left: retired
    assert counts(rid)["transcripts"] == 2 and duplicate_keys(rid) == []


def test_ac09_edited_verse_correction_is_not_undone_by_reprocessing(client, login):
    """AC-09 An editor's verse correction (edit ROM.8.31 -> ROM.8.32) survives reprocessing and the corrected-away verse is not re-added."""
    rid = doc_resource(client, login)
    process_now(rid)
    wrong = link_by_ref(rid, "ROM.8.31")
    resp = client.patch(f"/v1/admin/mappings/{wrong['id']}", json={"verse_ref": "ROM.8.32", "note": "speaker meant 8:32"}, headers=login(EDITOR))
    assert resp.status_code == 200
    process_now(rid)
    assert link_by_ref(rid, "ROM.8.32")["review_status"] == "approved"
    old = link_by_ref(rid, "ROM.8.31")
    # the corrected-away verse is kept only as a rejected, human-owned tombstone - never re-published
    assert old is None or (old["review_status"] == "rejected" and old["is_human_verified"] and old["provenance"].get("tombstone_for") == wrong["id"])
    intel = client.get("/v1/verses/ROM.8.31/intelligence").json()
    assert all(c["resource"]["id"] != rid for c in intel["top_resources"])


# ----------------------------------------------------------------------------- AC-12
def _flaky(real, failures: int = 1):
    state = {"calls": 0}

    def wrapper(*args, **kwargs):
        state["calls"] += 1
        if state["calls"] <= failures:
            raise RuntimeError("transient failure injected by test")
        return real(*args, **kwargs)

    return wrapper, state


def test_ac12_failed_stage_retries_through_the_job_queue_without_duplicates(client, login, monkeypatch):
    """AC-12 A processing failure at one stage (quote detection) can be retried by the worker without duplicates."""
    clean = doc_resource(client, login, title="clean twin")
    assert process_now(clean)["status"] == "succeeded"
    rid = doc_resource(client, login, title="flaky")
    wrapper, state = _flaky(detectors.detect_quotes)
    monkeypatch.setattr(detectors, "detect_quotes", wrapper)

    queued = client.post(f"/v1/resources/{rid}/process", headers=login(EDITOR)).json()
    assert run_worker_once(("pipeline",))
    run = sql_one("SELECT status, error, stages, attempts FROM processing_runs WHERE id = :id", id=queued["run_id"])
    assert run["status"] == "failed" and "transient failure injected" in run["error"]
    assert {s["id"]: s["status"] for s in run["stages"]}["ING-07"] == "failed"
    job = sql_one("SELECT status, attempts, last_error FROM jobs WHERE id = :id", id=queued["job_id"])
    assert job["status"] == "queued" and job["attempts"] == 1 and "transient failure injected" in job["last_error"]
    assert sql_one("SELECT status FROM resources WHERE id = :r", r=rid)["status"] == "failed"
    assert counts(rid)["segments"] == 0 and counts(rid)["transcripts"] == 1  # extracted text kept for the retry

    sql_exec("UPDATE jobs SET run_after = now() WHERE id = :id", id=queued["job_id"])
    assert run_worker_once(("pipeline",))
    run = sql_one("SELECT status, error, attempts FROM processing_runs WHERE id = :id", id=queued["run_id"])
    assert run["status"] == "succeeded" and run["error"] is None and run["attempts"] == 2
    assert sql_one("SELECT status FROM jobs WHERE id = :id", id=queued["job_id"])["status"] == "succeeded"
    assert counts(rid) == counts(clean)
    assert refs(links_for(rid)) == refs(links_for(clean))
    assert duplicate_keys(rid) == []


def test_ac12_failure_after_persistence_retries_without_duplicates(client, login, monkeypatch):
    """AC-12 A failure after mappings were stored (metrics stage) re-runs cleanly: same segments/mappings, no duplicates."""
    clean = doc_resource(client, login, title="clean twin")
    process_now(clean)
    rid = doc_resource(client, login, title="fails late")
    wrapper, _ = _flaky(orchestrator._run_metrics)
    monkeypatch.setattr(orchestrator, "_run_metrics", wrapper)
    with pytest.raises(RuntimeError, match="transient failure"):
        process_now(rid)
    assert sql_one("SELECT status FROM resources WHERE id = :r", r=rid)["status"] == "processed"  # partial results stay readable
    partial = counts(rid)
    assert partial["links"] > 0
    assert process_now(rid)["status"] == "succeeded"
    assert counts(rid) == counts(clean) == partial
    assert duplicate_keys(rid) == []
    assert sql("SELECT status FROM processing_runs WHERE resource_id = :r ORDER BY created_at", r=rid) == [{"status": "failed"}, {"status": "succeeded"}]


def test_ac12_media_clip_stage_failure_then_retry(client, login, monkeypatch, silent_mp3):
    """AC-12 A failure in the clip stage (ING-12) of a media resource retries to an identical result."""
    from interactive_bible.pipeline import enrich

    from .support import upload, vtt

    captions = vtt([(1.0, 5.0, "Tonight we read John 3:16 together."), (5.5, 16.0, "God so loved the world, and so we pray.")])
    ids = []
    for title in ("clean media", "flaky media"):
        res = create_resource(client, login(EDITOR), type="audio", title=title, transcript_mode="captions")
        upload(client, login(EDITOR), res["id"], silent_mp3, "a.mp3")
        upload(client, login(EDITOR), res["id"], captions, "a.vtt", kind="captions")
        ids.append(res["id"])
    clean, rid = ids
    process_now(clean)
    wrapper, state = _flaky(enrich.select_clip)
    monkeypatch.setattr(enrich, "select_clip", wrapper)
    with pytest.raises(RuntimeError):
        process_now(rid)
    assert process_now(rid)["status"] == "succeeded" and state["calls"] >= 2
    clip = lambda r: sql_one("SELECT clip_start_ms, clip_end_ms, clip_core_start_ms, clip_core_end_ms, clip_review_status FROM resource_segments WHERE resource_id = :r", r=r)  # noqa: E731
    assert clip(rid) == clip(clean) and clip(rid)["clip_review_status"] == "auto"
    assert counts(rid) == counts(clean) and duplicate_keys(rid) == []


def test_reviewed_clip_boundaries_survive_reprocessing(client, login, silent_mp3):
    from .support import upload, vtt

    res = create_resource(client, login(EDITOR), type="audio", title="clip review", transcript_mode="captions")
    upload(client, login(EDITOR), res["id"], silent_mp3, "a.mp3")
    upload(client, login(EDITOR), res["id"], vtt([(1.0, 5.0, "Tonight we read John 3:16 together."), (5.5, 16.0, "And we pray.")]), "a.vtt", kind="captions")
    process_now(res["id"])
    seg = sql_one("SELECT id FROM resource_segments WHERE resource_id = :r", r=res["id"])["id"]
    bad = client.patch(f"/v1/admin/segments/{seg}/clip", json={"start_ms": 5000, "end_ms": 900_000}, headers=login(EDITOR))
    assert bad.status_code == 422
    edited = client.patch(f"/v1/admin/segments/{seg}/clip", json={"start_ms": 900, "end_ms": 15000, "note": "include the prayer"}, headers=login(EDITOR))
    assert edited.status_code == 200 and edited.json()["clip_review_status"] == "edited"
    process_now(res["id"])
    row = sql_one("SELECT clip_start_ms, clip_end_ms, clip_review_status FROM resource_segments WHERE id = :s", s=seg)
    assert row == {"clip_start_ms": 900, "clip_end_ms": 15000, "clip_review_status": "edited"}
    audit = sql_one("SELECT previous_value, new_value, note FROM review_actions WHERE object_id = :s AND action = 'edit_clip'", s=seg)
    assert audit["new_value"] == {"start_ms": 900, "end_ms": 15000} and audit["note"] == "include the prayer"

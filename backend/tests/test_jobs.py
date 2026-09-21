"""PostgreSQL job queue (claim / retry with backoff / dead letter / dedupe / stale locks) and the worker loop."""
from __future__ import annotations

import pytest

from interactive_bible import jobs, worker
from interactive_bible.ai.llm import AIUnavailable
from interactive_bible.db import session_scope

from .support import EDITOR, MEMBER, run_worker_once, sql, sql_exec, sql_one


def enqueue(job_type: str = "export_clip", payload: dict | None = None, **kw) -> str | None:
    with session_scope() as s:
        return jobs.enqueue(s, job_type, payload or {}, **kw)


def claim(queues: list[str], worker_id: str = "w1") -> dict | None:
    with session_scope() as s:
        return jobs.claim(s, queues, worker_id)


def make_due(job_id: str) -> None:
    sql_exec("UPDATE jobs SET run_after = now() - interval '1 second' WHERE id = :id", id=job_id)


def test_enqueue_routes_job_types_to_queues():
    ids = {t: enqueue(t, {"n": 1}) for t in ("process_resource", "embed_bible", "enrich_verse", "export_clip", "something_else")}
    rows = {r["type"]: r for r in sql("SELECT id, type, queue, status, attempts, max_attempts, payload FROM jobs")}
    assert {t: rows[t]["queue"] for t in ids} == {"process_resource": "pipeline", "embed_bible": "embeddings", "enrich_verse": "ai", "export_clip": "media", "something_else": "default"}
    assert all(r["status"] == "queued" and r["attempts"] == 0 and r["payload"] == {"n": 1} for r in rows.values())


def test_dedupe_key_returns_the_active_job_until_it_finishes():
    first = enqueue(dedupe_key="export:seg_1")
    assert enqueue(dedupe_key="export:seg_1") == first
    assert sql_one("SELECT count(*) AS n FROM jobs")["n"] == 1
    job = claim(["media"])
    assert job["id"] == first and job["status"] == "running"
    assert enqueue(dedupe_key="export:seg_1") == first  # still active while running
    with session_scope() as s:
        jobs.complete(s, first, {"ok": True})
    again = enqueue(dedupe_key="export:seg_1")
    assert again and again != first
    assert sql_one("SELECT result FROM jobs WHERE id = :id", id=first)["result"] == {"ok": True}


def test_claim_respects_queue_priority_run_after_and_skip_locked():
    low = enqueue(priority=200)
    high = enqueue(priority=10)
    later = enqueue(priority=1, delay_seconds=3600)
    other_queue = enqueue("process_resource", priority=1)
    got = claim(["media"], "w1")
    assert got["id"] == high and got["locked_by"] == "w1" and got["attempts"] == 1
    assert claim(["media"], "w2")["id"] == low
    assert claim(["media"], "w3") is None  # the delayed job is not due and other queues are ignored
    assert sql_one("SELECT status FROM jobs WHERE id = :id", id=later)["status"] == "queued"
    assert claim(["pipeline"])["id"] == other_queue


def test_failures_retry_with_backoff_then_go_dead():
    job_id = enqueue(max_attempts=3)
    delays = []
    for attempt in (1, 2, 3):
        job = claim(["media"])
        assert job and job["id"] == job_id and job["attempts"] == attempt
        with session_scope() as s:
            outcome = jobs.fail(s, job, f"boom {attempt}")
        row = sql_one("SELECT status, last_error, locked_by, extract(epoch FROM run_after - now()) AS wait FROM jobs WHERE id = :id", id=job_id)
        if attempt < 3:
            assert outcome == "requeued" and row["status"] == "queued" and row["locked_by"] is None
            delays.append(float(row["wait"]))
            assert claim(["media"]) is None  # backoff: not claimable yet
            make_due(job_id)
        else:
            assert outcome == "dead" and row["status"] == "dead"
        assert row["last_error"] == f"boom {attempt}"
    assert 10 < delays[0] <= 15 and 50 < delays[1] <= 60  # 15 s, then 60 s


def test_non_retryable_failure_is_dead_immediately():
    job_id = enqueue(max_attempts=5)
    job = claim(["media"])
    with session_scope() as s:
        assert jobs.fail(s, job, "not configured", retryable=False) == "dead"
    assert sql_one("SELECT status, attempts FROM jobs WHERE id = :id", id=job_id) == {"status": "dead", "attempts": 1}


def test_stale_running_jobs_are_recovered():
    job_id = enqueue()
    claim(["media"])
    sql_exec("UPDATE jobs SET locked_at = now() - interval '2 hours' WHERE id = :id", id=job_id)
    fresh = enqueue(dedupe_key="fresh")
    claim(["media"])
    with session_scope() as s:
        assert jobs.recover_stale(s) == 1
    rows = {r["id"]: r for r in sql("SELECT id, status, locked_by, last_error FROM jobs")}
    assert rows[job_id]["status"] == "queued" and rows[job_id]["locked_by"] is None and "recovered stale lock" in rows[job_id]["last_error"]
    assert rows[fresh]["status"] == "running"


def test_jobs_of_workers_that_stopped_heartbeating_are_recovered_quickly():
    dead_job, live_job, own_job = enqueue(dedupe_key="a"), enqueue(dedupe_key="b"), enqueue(dedupe_key="c")
    claim(["media"], "dead-worker"), claim(["media"], "busy-worker"), claim(["media"], "this-process")
    sql_exec("UPDATE jobs SET locked_at = now() - interval '10 minutes'")  # well inside the 30 minute lock timeout
    sql_exec("""INSERT INTO worker_heartbeats (worker_id, queues, hostname, pid, seen_at) VALUES
                ('dead-worker', ARRAY['media'], 'h', 1, now() - interval '10 minutes'),
                ('busy-worker', ARRAY['media'], 'h', 2, now() - interval '5 seconds'),
                ('this-process', ARRAY['media'], 'h', 3, now() - interval '10 minutes')""")
    with session_scope() as s:
        assert jobs.recover_stale(s, exclude_workers=["this-process"]) == 1
    rows = {r["id"]: r["status"] for r in sql("SELECT id, status FROM jobs")}
    assert rows == {dead_job: "queued", live_job: "running", own_job: "running"}


def test_graceful_shutdown_hands_in_flight_jobs_back_without_spending_attempts():
    import threading

    mine, other = enqueue(dedupe_key="mine"), enqueue(dedupe_key="other")
    claim(["media"], "stopping-worker"), claim(["media"], "other-worker")
    sql_exec("INSERT INTO worker_heartbeats (worker_id, queues, hostname, pid, seen_at) VALUES ('stopping-worker', ARRAY['media'], 'h', 1, now())")
    busy = threading.Thread(target=threading.Event().wait, args=(0.1,))
    busy.start()
    assert worker.graceful_shutdown(["stopping-worker"], [busy]) == 1
    row = sql_one("SELECT status, attempts, locked_by, last_error FROM jobs WHERE id = :id", id=mine)
    assert row["status"] == "queued" and row["attempts"] == 0 and row["locked_by"] is None and "released on worker shutdown" in row["last_error"]
    assert sql_one("SELECT status FROM jobs WHERE id = :id", id=other)["status"] == "running"
    assert sql_one("SELECT count(*) AS n FROM worker_heartbeats")["n"] == 0
    assert claim(["media"], "restarted-worker")["id"] == mine  # immediately claimable again


def test_worker_runs_handlers_and_records_results(monkeypatch):
    seen = []
    monkeypatch.setitem(worker.HANDLERS, "unit_test_job", lambda payload: seen.append(payload) or {"echo": payload["value"]})
    job_id = enqueue("unit_test_job", {"value": 42})
    assert run_worker_once(("default",)) is True
    assert seen == [{"value": 42}]
    assert sql_one("SELECT status, result, attempts, locked_by FROM jobs WHERE id = :id", id=job_id) == {"status": "succeeded", "result": {"echo": 42}, "attempts": 1, "locked_by": None}
    assert sql_one("SELECT worker_id, current_job FROM worker_heartbeats") == {"worker_id": "pytest-worker", "current_job": None}
    assert run_worker_once(("default",)) is False


def test_worker_requeues_unexpected_errors_with_traceback(monkeypatch):
    def explode(_payload):
        raise RuntimeError("disk on fire")

    monkeypatch.setitem(worker.HANDLERS, "unit_test_job", explode)
    job_id = enqueue("unit_test_job", {})
    run_worker_once(("default",))
    row = sql_one("SELECT status, attempts, last_error FROM jobs WHERE id = :id", id=job_id)
    assert row["status"] == "queued" and row["attempts"] == 1
    assert "RuntimeError: disk on fire" in row["last_error"] and "Traceback" in row["last_error"]


@pytest.mark.parametrize("message,expected", [("GEMINI_API_KEY is not configured", "dead"), ("daily Gemini token budget (5) exhausted", "dead"), ("Gemini call failed: 503", "queued")])
def test_worker_ai_failures_only_retry_when_transient(monkeypatch, message, expected):
    def ai_down(_payload):
        raise AIUnavailable(message)

    monkeypatch.setitem(worker.HANDLERS, "unit_test_job", ai_down)
    job_id = enqueue("unit_test_job", {})
    run_worker_once(("default",))
    assert sql_one("SELECT status FROM jobs WHERE id = :id", id=job_id)["status"] == expected


def test_worker_unknown_job_type_fails():
    job_id = enqueue("no_such_handler", {})
    run_worker_once(("default",))
    assert "no handler for job type no_such_handler" in sql_one("SELECT last_error FROM jobs WHERE id = :id", id=job_id)["last_error"]


def _dead_job() -> str:
    job_id = enqueue(max_attempts=1)
    job = claim(["media"])
    with session_scope() as s:
        jobs.fail(s, job, "boom")
    return job_id


def test_admin_can_retry_dead_jobs_and_members_cannot(client, login):
    job_id = _dead_job()
    assert client.post(f"/v1/admin/jobs/{job_id}/retry", headers=login(MEMBER)).status_code == 403
    assert client.get("/v1/admin/jobs?status=dead", headers=login(MEMBER)).status_code == 403
    assert client.post(f"/v1/admin/jobs/{job_id}/retry").status_code == 401
    assert client.post(f"/v1/admin/jobs/{job_id}/retry", headers=login(EDITOR)).json() == {"id": job_id, "status": "queued"}
    assert sql_one("SELECT status, attempts FROM jobs WHERE id = :id", id=job_id) == {"status": "queued", "attempts": 0}


def test_admin_can_list_jobs_with_and_without_status_filter(_app_client, login):
    from fastapi.testclient import TestClient

    from interactive_bible.api.main import app

    job_id = _dead_job()
    enqueue(dedupe_key="another")
    client = TestClient(app, raise_server_exceptions=False)
    everything = client.get("/v1/admin/jobs", headers=login(EDITOR))
    assert everything.status_code == 200, everything.text
    assert len(everything.json()) == 2
    dead = client.get("/v1/admin/jobs?status=dead", headers=login(EDITOR))
    assert dead.status_code == 200 and [j["id"] for j in dead.json()] == [job_id]


def test_heartbeats_of_long_gone_workers_are_pruned_after_their_jobs_are_recovered():
    job_id = enqueue()
    claim(["media"], "gone-with-job")
    sql_exec("UPDATE jobs SET locked_at = now() - interval '2 hours' WHERE id = :id", id=job_id)
    sql_exec("""INSERT INTO worker_heartbeats (worker_id, queues, hostname, pid, seen_at) VALUES
                ('gone-with-job', ARRAY['media'], 'h', 1, now() - interval '2 hours'),
                ('gone-idle', ARRAY['media'], 'h', 2, now() - interval '2 hours'),
                ('alive', ARRAY['media'], 'h', 3, now())""")
    with session_scope() as s:
        assert jobs.prune_heartbeats(s) == 1  # the row still holding a running job is kept for recovery
        assert jobs.recover_stale(s) == 1
        assert jobs.prune_heartbeats(s) == 1
    assert [r["worker_id"] for r in sql("SELECT worker_id FROM worker_heartbeats")] == ["alive"]
    assert sql_one("SELECT status FROM jobs WHERE id = :id", id=job_id)["status"] == "queued"

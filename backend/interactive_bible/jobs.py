"""PostgreSQL-backed job queue (SELECT ... FOR UPDATE SKIP LOCKED). Jobs are idempotent and retried with backoff."""
from __future__ import annotations

import contextvars
from typing import Any

from sqlalchemy.orm import Session

from .config import get_settings
from .db import execute, fetch_one, json_dumps
from .ids import new_id

QUEUES = {
    "process_resource": "pipeline",
    "embed_bible": "embeddings",
    "explain_relationship": "ai",
    "enrich_verse": "ai",
    "export_clip": "media",
    "generate_caption": "ai",
    "generate_story": "ai",
    "export_story_video": "media",
}

current_job_id: contextvars.ContextVar[str | None] = contextvars.ContextVar("current_job_id", default=None)


def report_progress(step: str, done: int | None = None, total: int | None = None, message: str | None = None) -> None:
    """Record progress for the job running in this context (no-op outside a worker job)."""
    job_id = current_job_id.get()
    if not job_id:
        return
    from .db import session_scope

    progress = {"step": step, "done": done, "total": total, "message": message}
    try:
        with session_scope() as s:
            execute(s, "UPDATE jobs SET progress = CAST(:p AS jsonb), updated_at = now() WHERE id = :id", p=json_dumps(progress), id=job_id)
    except Exception:  # noqa: BLE001 - progress is best effort
        pass


def enqueue(session: Session, job_type: str, payload: dict[str, Any], *, dedupe_key: str | None = None, priority: int = 100,
            max_attempts: int = 3, delay_seconds: int = 0) -> str | None:
    queue = QUEUES.get(job_type, "default")
    job_id = new_id("job")
    row = fetch_one(
        session,
        """INSERT INTO jobs (id, queue, type, payload, status, priority, max_attempts, run_after, dedupe_key)
           VALUES (:id, :q, :t, CAST(:p AS jsonb), 'queued', :prio, :max, now() + make_interval(secs => :delay), :dk)
           ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL AND status IN ('queued', 'running') DO NOTHING
           RETURNING id""",
        id=job_id, q=queue, t=job_type, p=json_dumps(payload), prio=priority, max=max_attempts, delay=delay_seconds, dk=dedupe_key,
    )
    if row:
        execute(session, "SELECT pg_notify('ibible_jobs', :q)", q=queue)
        return row["id"]
    existing = fetch_one(session, "SELECT id FROM jobs WHERE dedupe_key = :dk AND status IN ('queued', 'running')", dk=dedupe_key)
    return existing["id"] if existing else None


def claim(session: Session, queues: list[str], worker_id: str) -> dict[str, Any] | None:
    return fetch_one(
        session,
        """UPDATE jobs SET status = 'running', locked_by = :w, locked_at = now(), attempts = attempts + 1, updated_at = now()
           WHERE id = (
               SELECT id FROM jobs WHERE status = 'queued' AND run_after <= now() AND queue = ANY(:queues)
               ORDER BY priority, created_at FOR UPDATE SKIP LOCKED LIMIT 1)
           RETURNING *""",
        w=worker_id, queues=queues,
    )


def complete(session: Session, job_id: str, result: dict[str, Any] | None = None) -> None:
    execute(session, "UPDATE jobs SET status = 'succeeded', result = CAST(:r AS jsonb), locked_by = NULL, updated_at = now() WHERE id = :id",
            r=json_dumps(result or {}), id=job_id)


def fail(session: Session, job: dict[str, Any], error: str, retryable: bool = True) -> str:
    attempts, max_attempts = job["attempts"], job["max_attempts"]
    if retryable and attempts < max_attempts:
        delay = min(600, 15 * (4 ** (attempts - 1)))
        execute(session, """UPDATE jobs SET status = 'queued', last_error = :e, locked_by = NULL, locked_at = NULL,
                               run_after = now() + make_interval(secs => :d), updated_at = now() WHERE id = :id""",
                e=error[:4000], d=delay, id=job["id"])
        return "requeued"
    execute(session, "UPDATE jobs SET status = 'dead', last_error = :e, locked_by = NULL, updated_at = now() WHERE id = :id", e=error[:4000], id=job["id"])
    return "dead"


def recover_stale(session: Session, exclude_workers: list[str] | None = None) -> int:
    """Requeue running jobs whose lock expired, or whose worker stopped heart-beating (crashed or was killed)."""
    s = get_settings()
    res = execute(session, """UPDATE jobs SET status = 'queued', locked_by = NULL, locked_at = NULL, updated_at = now(),
                                  last_error = coalesce(last_error, '') || ' [recovered stale lock]'
                              WHERE status = 'running' AND NOT (coalesce(locked_by, '') = ANY(:mine))
                                AND (locked_at < now() - make_interval(mins => :m)
                                     OR (locked_at < now() - make_interval(secs => :hb) AND EXISTS (
                                            SELECT 1 FROM worker_heartbeats h WHERE h.worker_id = jobs.locked_by AND h.seen_at < now() - make_interval(secs => :hb))))""",
                  m=s.job_lock_timeout_minutes, hb=s.worker_heartbeat_stale_seconds, mine=list(exclude_workers or []))
    return res.rowcount or 0


def prune_heartbeats(session: Session) -> int:
    """Forget workers that have been gone for an hour (their running jobs were already recovered)."""
    res = execute(session, """DELETE FROM worker_heartbeats h WHERE h.seen_at < now() - interval '1 hour'
                              AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.status = 'running' AND j.locked_by = h.worker_id)""")
    return res.rowcount or 0


def release_locked(session: Session, worker_ids: list[str]) -> int:
    """Graceful worker shutdown: hand in-flight jobs back to the queue without spending an attempt (handlers are idempotent)."""
    res = execute(session, """UPDATE jobs SET status = 'queued', locked_by = NULL, locked_at = NULL, run_after = now(), updated_at = now(),
                                  attempts = greatest(attempts - 1, 0), last_error = coalesce(last_error, '') || ' [released on worker shutdown]'
                              WHERE status = 'running' AND locked_by = ANY(:w)""", w=list(worker_ids))
    return res.rowcount or 0

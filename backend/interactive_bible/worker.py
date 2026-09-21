"""Background worker: `python -m interactive_bible.worker --queues pipeline,embeddings,ai,media`."""
from __future__ import annotations

import argparse
import logging
import os
import signal
import socket
import threading
import time
import traceback
from typing import Any, Callable

from . import jobs
from .ai.llm import AIInvalidOutput, AIUnavailable
from .config import get_settings
from .db import execute, session_scope
from .ids import new_id
from .logging_setup import setup_logging

log = logging.getLogger("interactive_bible.worker")
HANDLERS: dict[str, Callable[[dict[str, Any]], dict[str, Any] | None]] = {}


def handler(name: str):
    def wrap(fn):
        HANDLERS[name] = fn
        return fn
    return wrap


@handler("process_resource")
def _process(payload: dict[str, Any]) -> dict[str, Any]:
    from .pipeline.orchestrator import process_resource

    return process_resource(payload["resource_id"], payload["run_id"], payload.get("options") or {})


@handler("embed_bible")
def _embed(payload: dict[str, Any]) -> dict[str, Any]:
    from .services.embeddings import embed_bible_batch

    return embed_bible_batch(max_batches=int(payload.get("max_batches", 20)))


@handler("explain_relationship")
def _explain(payload: dict[str, Any]) -> dict[str, Any]:
    from .services.related import explain_relationship

    return explain_relationship(int(payload["relationship_id"]))


@handler("enrich_verse")
def _enrich(payload: dict[str, Any]) -> dict[str, Any]:
    from .services.related import enrich_verse

    return enrich_verse(int(payload["verse_id"]))


@handler("export_clip")
def _export(payload: dict[str, Any]) -> dict[str, Any]:
    from .services.clips import export_clip_file

    return export_clip_file(payload["segment_id"], payload.get("requested_by"))


@handler("generate_story")
def _generate_story(payload: dict[str, Any]) -> dict[str, Any]:
    from .services.explore.stories import generate_story

    return generate_story(payload)


@handler("export_story_video")
def _export_story_video(payload: dict[str, Any]) -> dict[str, Any]:
    from .services.explore.video import export_story_video

    return export_story_video(payload)


class Worker:
    def __init__(self, queues: list[str], worker_id: str | None = None) -> None:
        self.queues = queues
        self.worker_id = worker_id or f"{socket.gethostname()}:{os.getpid()}:{new_id('w')[-6:]}"
        self.stop = threading.Event()

    def heartbeat(self, current: str | None = None) -> None:
        with session_scope() as s:
            execute(s, """INSERT INTO worker_heartbeats (worker_id, queues, hostname, pid, current_job, seen_at)
                          VALUES (:w, :q, :h, :p, :c, now())
                          ON CONFLICT (worker_id) DO UPDATE SET seen_at = now(), current_job = EXCLUDED.current_job""",
                    w=self.worker_id, q=self.queues, h=socket.gethostname(), p=os.getpid(), c=current)

    def run_once(self) -> bool:
        with session_scope() as s:
            job = jobs.claim(s, self.queues, self.worker_id)
        if not job:
            return False
        self.heartbeat(job["id"])
        fn = HANDLERS.get(job["type"])
        log.info("job %s (%s) attempt %s", job["id"], job["type"], job["attempts"])
        job_token = jobs.current_job_id.set(job["id"])
        try:
            if fn is None:
                raise RuntimeError(f"no handler for job type {job['type']}")
            result = fn(job["payload"]) or {}
        except (AIUnavailable, AIInvalidOutput) as exc:
            retryable = "not configured" not in str(exc) and "budget" not in str(exc)
            with session_scope() as s:
                outcome = jobs.fail(s, job, f"{type(exc).__name__}: {exc}", retryable=retryable)
            log.warning("job %s AI failure (%s): %s", job["id"], outcome, exc)
        except Exception as exc:  # noqa: BLE001
            with session_scope() as s:
                outcome = jobs.fail(s, job, f"{type(exc).__name__}: {exc}\n{traceback.format_exc()[-1500:]}")
            log.error("job %s failed (%s): %s", job["id"], outcome, exc)
        else:
            with session_scope() as s:
                jobs.complete(s, job["id"], result)
                if job["type"] == "embed_bible" and result.get("remaining", 0) > 0 and not result.get("stopped"):
                    jobs.enqueue(s, "embed_bible", job["payload"], dedupe_key="embed_bible", priority=200, delay_seconds=1)
            log.info("job %s done", job["id"])
        finally:
            jobs.current_job_id.reset(job_token)
            self.heartbeat(None)
        return True

    def run(self, local_worker_ids: list[str] | None = None) -> None:
        log.info("worker %s listening on %s", self.worker_id, ",".join(self.queues))
        last_recover = 0.0
        while not self.stop.is_set():
            try:
                if time.monotonic() - last_recover > 60:
                    with session_scope() as s:
                        recovered = jobs.recover_stale(s, exclude_workers=local_worker_ids or [self.worker_id])
                        jobs.prune_heartbeats(s)
                    if recovered:
                        log.warning("requeued %d job(s) from stopped or unresponsive workers", recovered)
                    self.heartbeat(None)
                    last_recover = time.monotonic()
                if not self.run_once():
                    self.stop.wait(get_settings().worker_poll_seconds)
            except Exception:  # noqa: BLE001
                log.exception("worker loop error")
                self.stop.wait(5)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--queues", default="pipeline,embeddings,ai,media,default")
    parser.add_argument("--threads", type=int, default=2, help="parallel job loops in this process")
    args = parser.parse_args()
    setup_logging()
    queues = [q.strip() for q in args.queues.split(",") if q.strip()]
    workers = [Worker(queues) for _ in range(max(1, args.threads))]
    ids = [w.worker_id for w in workers]
    stopping: list[int] = []  # appended by the signal handler; a plain list so the handler never takes a lock the main thread holds

    def shutdown(signum: int, _frame: Any) -> None:
        stopping.append(signum)
        for w in workers:
            w.stop.set()

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)
    threads = [threading.Thread(target=w.run, args=(ids,), daemon=True) for w in workers]
    for t in threads:
        t.start()
    heartbeat_stop = threading.Event()
    threading.Thread(target=_heartbeat_loop, args=(ids, heartbeat_stop), daemon=True).start()
    while not stopping and any(t.is_alive() for t in threads):
        time.sleep(0.5)
    heartbeat_stop.set()
    graceful_shutdown(ids, threads)


def _heartbeat_loop(worker_ids: list[str], stopping: threading.Event) -> None:
    """Keep heartbeats fresh while long jobs run, so other workers can tell a busy worker from a dead one."""
    while not stopping.wait(20):
        try:
            with session_scope() as s:
                execute(s, "UPDATE worker_heartbeats SET seen_at = now() WHERE worker_id = ANY(:w)", w=worker_ids)
        except Exception:  # noqa: BLE001
            log.warning("heartbeat update failed", exc_info=True)


def graceful_shutdown(worker_ids: list[str], threads: list[threading.Thread]) -> int:
    """Let short jobs finish; hand longer ones back to the queue so a restarted worker resumes them at once."""
    deadline = time.monotonic() + get_settings().worker_shutdown_grace_seconds
    while any(t.is_alive() for t in threads) and time.monotonic() < deadline:
        time.sleep(0.2)
    released = 0
    try:
        with session_scope() as s:
            released = jobs.release_locked(s, worker_ids)
            execute(s, "DELETE FROM worker_heartbeats WHERE worker_id = ANY(:w)", w=worker_ids)
    except Exception:  # noqa: BLE001
        log.exception("could not release in-flight jobs on shutdown")
    if released:
        log.warning("released %d in-flight job(s) back to the queue", released)
    log.info("worker stopped")
    return released


if __name__ == "__main__":
    main()
    logging.shutdown()
    os._exit(0)  # do not wait for job threads that were handed back to the queue

"""Observability (spec §14): processing latency, AI cost, failures, mapping counts, confidence distribution,
review rejection rate, search quality signals, feedback error rate, cache/queue health, and a Gemini doctor."""
from __future__ import annotations

import os
import shutil
import time
from typing import Any

from sqlalchemy.orm import Session

from .. import cache
from ..ai.gemini import GeminiError, get_gemini_client
from ..ai.llm import get_llm
from ..ai.prompt_pack import prompt_versions
from ..config import get_settings
from ..db import fetch_all, fetch_one
from .embeddings import embedding_progress

_DOCTOR: dict[str, Any] = {}


def dashboard(session: Session, days: int = 7) -> dict[str, Any]:
    runs = fetch_all(session, """SELECT status, count(*) AS n, avg(extract(epoch FROM (completed_at - started_at)))::float AS avg_seconds, count(*) FILTER (WHERE degraded) AS degraded
                                 FROM processing_runs WHERE created_at > now() - make_interval(days => :d) GROUP BY status""", d=days)
    stage_latency = fetch_all(session, """SELECT key AS stage, avg(value::text::float)::float AS avg_ms, max(value::text::float)::float AS max_ms
                                          FROM processing_runs, jsonb_each(metrics->'stage_ms') WHERE created_at > now() - make_interval(days => :d) GROUP BY key ORDER BY key""", d=days)
    ai = fetch_one(session, """SELECT count(*) AS calls, count(*) FILTER (WHERE cached) AS cached, count(*) FILTER (WHERE status NOT IN ('ok','cached')) AS failures,
                                      coalesce(sum(prompt_tokens),0) AS prompt_tokens, coalesce(sum(output_tokens + thought_tokens),0) AS output_tokens,
                                      coalesce(sum(cost_usd),0)::float AS cost_usd, avg(latency_ms) FILTER (WHERE NOT cached)::float AS avg_latency_ms
                               FROM llm_calls WHERE created_at > now() - make_interval(days => :d)""", d=days)
    ai_today = fetch_one(session, "SELECT coalesce(sum(prompt_tokens + output_tokens + thought_tokens),0) AS tokens, coalesce(sum(cost_usd),0)::float AS cost_usd FROM llm_calls WHERE created_at >= date_trunc('day', now()) AND NOT cached")
    by_prompt = fetch_all(session, """SELECT prompt_id, count(*) AS calls, count(*) FILTER (WHERE cached) AS cached, count(*) FILTER (WHERE status NOT IN ('ok','cached')) AS failures,
                                             avg(latency_ms) FILTER (WHERE NOT cached)::float AS avg_latency_ms, coalesce(sum(cost_usd),0)::float AS cost_usd
                                      FROM llm_calls WHERE created_at > now() - make_interval(days => :d) GROUP BY prompt_id ORDER BY prompt_id""", d=days)
    ai_errors = fetch_all(session, "SELECT status, count(*) AS n FROM llm_calls WHERE status NOT IN ('ok','cached') AND created_at > now() - make_interval(days => :d) GROUP BY status", d=days)
    mappings = fetch_all(session, "SELECT relationship_type, review_status, count(*) AS n FROM verse_resource_links WHERE parent_link_id IS NULL GROUP BY relationship_type, review_status")
    histogram = fetch_all(session, """SELECT width_bucket(confidence, 0, 1, 20) AS bucket, count(*) AS n FROM verse_resource_links WHERE parent_link_id IS NULL GROUP BY bucket ORDER BY bucket""")
    review = fetch_one(session, """SELECT count(*) FILTER (WHERE action = 'approve') AS approved, count(*) FILTER (WHERE action = 'reject') AS rejected,
                                          count(*) FILTER (WHERE action IN ('edit','merge','add')) AS edited
                                   FROM review_actions WHERE object_type = 'mapping' AND created_at > now() - make_interval(days => :d)""", d=days)
    queue = fetch_one(session, "SELECT count(*) AS n FROM verse_resource_links WHERE parent_link_id IS NULL AND needs_review AND review_status NOT IN ('approved','rejected')")
    search = fetch_one(session, """SELECT count(*) AS searches, avg(latency_ms)::float AS avg_latency_ms, count(*) FILTER (WHERE result_count = 0) AS zero_results
                                   FROM search_logs WHERE created_at > now() - make_interval(days => :d)""", d=days)
    feedback = fetch_all(session, "SELECT kind, count(*) AS n FROM feedback WHERE created_at > now() - make_interval(days => :d) GROUP BY kind", d=days)
    views = fetch_one(session, "SELECT coalesce(sum((payload->>'cards')::int), 0) AS mapping_views FROM analytics_events WHERE type = 'verse_intelligence_view' AND created_at > now() - make_interval(days => :d)", d=days)
    error_reports = sum(f["n"] for f in feedback if f["kind"] in ("wrong_verse", "wrong_timestamp", "wrong_quote_reference", "not_relevant"))
    jobs = fetch_all(session, "SELECT queue, status, count(*) AS n FROM jobs GROUP BY queue, status ORDER BY queue, status")
    workers = fetch_all(session, "SELECT worker_id, queues, current_job, seen_at, (seen_at > now() - interval '90 seconds') AS alive FROM worker_heartbeats ORDER BY seen_at DESC LIMIT 20")
    reviewed = (review["approved"] or 0) + (review["rejected"] or 0)
    return {
        "window_days": days,
        "processing": {"runs": runs, "stage_latency": stage_latency},
        "ai": {**ai, "today": ai_today, "daily_token_budget": get_settings().gemini_daily_token_budget, "by_prompt": by_prompt, "errors": ai_errors},
        "mappings": {"by_type_status": mappings, "confidence_histogram": [{"from": round((b["bucket"] - 1) * 0.05, 2), "to": round(b["bucket"] * 0.05, 2), "n": b["n"]} for b in histogram if b["bucket"]]},
        "review": {**review, "rejection_rate": round((review["rejected"] or 0) / reviewed, 3) if reviewed else None, "queue_open": queue["n"]},
        "search": {**search, "zero_result_rate": round((search["zero_results"] or 0) / search["searches"], 3) if search["searches"] else None},
        "feedback": {"by_kind": feedback, "mapping_views": views["mapping_views"], "errors_per_1000_views": round(1000 * error_reports / views["mapping_views"], 2) if views["mapping_views"] else None},
        "cache": {name: {"hits": c.hits, "misses": c.misses, "size": len(c._data)} for name, c in (("intelligence", cache.intelligence_cache), ("search", cache.search_cache))},
        "queue": {"jobs": jobs, "workers": workers},
    }


_STORAGE_USAGE: dict[str, Any] = {}


def storage_usage(max_age: float = 60.0) -> dict[str, Any]:
    """Local file storage (uploads, sermon and Explore media): size on disk and free space. Walked at most once a minute."""
    now = time.time()
    if _STORAGE_USAGE and now - _STORAGE_USAGE["checked_at"] < max_age:
        return _STORAGE_USAGE["value"]
    root = get_settings().storage_dir
    used = files = 0
    for dirpath, _dirs, names in os.walk(root):
        for name in names:
            try:
                used += os.stat(os.path.join(dirpath, name)).st_size
                files += 1
            except OSError:
                continue
    disk = shutil.disk_usage(root)
    value = {"used_bytes": used, "files": files, "disk_free_bytes": disk.free, "disk_total_bytes": disk.total}
    _STORAGE_USAGE.update(checked_at=now, value=value)
    return value


def system_status(session: Session) -> dict[str, Any]:
    s = get_settings()
    corpus = fetch_all(session, "SELECT id, abbreviation, name, verse_count, license, is_default FROM bible_translations ORDER BY is_default DESC, id")
    counts = fetch_one(session, """SELECT (SELECT count(*) FROM bible_verses) AS verses, (SELECT count(*) FROM verse_relationships WHERE source = 'openbible') AS cross_references,
                                          (SELECT count(*) FROM topics) AS topics, (SELECT count(*) FROM entities) AS entities,
                                          (SELECT count(*) FROM resources WHERE deleted_at IS NULL) AS resources,
                                          (SELECT count(*) FROM verse_resource_links WHERE parent_link_id IS NULL) AS mappings""")
    workers = fetch_one(session, "SELECT count(*) FILTER (WHERE seen_at > now() - interval '90 seconds') AS alive, max(seen_at) AS last_seen FROM worker_heartbeats")
    queue = fetch_one(session, "SELECT count(*) FILTER (WHERE status = 'queued') AS queued, count(*) FILTER (WHERE status = 'running') AS running, count(*) FILTER (WHERE status = 'dead') AS dead FROM jobs")
    migrations = [r["name"] for r in fetch_all(session, "SELECT name FROM schema_migrations ORDER BY name")]
    return {
        "database": {"ok": True, "migrations": migrations},
        "corpus": {"translations": corpus, **counts},
        "ai": {
            "provider": "gemini", "configured": get_llm().available, "models": {"analysis": s.gemini_model_analysis, "fast": s.gemini_model_fast, "transcribe": s.gemini_model_transcribe,
                                                                               "embedding": s.gemini_embed_model, "fallbacks": s.model_fallback_list,
                                                                               "image": s.gemini_image_model, "image_hq": s.gemini_image_model_hq, "speech": s.gemini_tts_model},
            "doctor": _DOCTOR or None, "prompt_versions": prompt_versions(), "pipeline_version": s.pipeline_version,
        },
        "embeddings": embedding_progress(),
        "workers": workers,
        "queue": queue,
        "storage": storage_usage(),
        "policy": {"feedback_hide_threshold": s.feedback_hide_threshold, "ai_creative_calls_per_hour": s.ai_creative_calls_per_hour,
                   "daily_token_budget": s.gemini_daily_token_budget, "single_user_mode": s.single_user_mode},
    }


def gemini_doctor(force: bool = False) -> dict[str, Any]:
    global _DOCTOR
    if _DOCTOR and not force and time.time() - _DOCTOR.get("checked_at", 0) < 600:
        return _DOCTOR
    s = get_settings()
    client = get_gemini_client()
    result: dict[str, Any] = {"checked_at": time.time(), "configured": client.configured}
    if not client.configured:
        result["ok"] = False
        result["message"] = "GEMINI_API_KEY is not set. Add it to .env and restart the API and worker."
        _DOCTOR = result
        return result
    try:
        models = client.list_models()
    except GeminiError as exc:
        result.update(ok=False, message=f"Could not list models: {exc}")
        _DOCTOR = result
        return result
    names = {m["name"].split("/", 1)[-1]: m for m in models}
    gen = sorted(n for n, m in names.items() if "generateContent" in m.get("supportedGenerationMethods", []))
    emb = sorted(n for n, m in names.items() if "embedContent" in m.get("supportedGenerationMethods", []) or "batchEmbedContents" in m.get("supportedGenerationMethods", []))
    checks = {}
    for role, model in (("analysis", s.gemini_model_analysis), ("fast", s.gemini_model_fast), ("transcribe", s.gemini_model_transcribe)):
        ok = model in gen
        fallback = next((f for f in s.model_fallback_list if f in gen), None)
        checks[role] = {"model": model, "available": ok, "fallback": None if ok else fallback}
    checks["embedding"] = {"model": s.gemini_embed_model, "available": s.gemini_embed_model in emb, "alternatives": emb[:5]}
    try:
        probe = client.generate(s.gemini_model_fast, "Reply with JSON only.", [{"text": 'Return {"ok": true}'}], json_schema={"type": "object", "properties": {"ok": {"type": "boolean"}}, "required": ["ok"]}, max_output_tokens=256)
        checks["generate_probe"] = {"ok": True, "model": probe.model, "latency_ms": probe.latency_ms}
    except GeminiError as exc:
        checks["generate_probe"] = {"ok": False, "error": str(exc)[:300]}
    try:
        emb_probe = client.embed(s.gemini_embed_model, ["Test embedding"], "RETRIEVAL_QUERY", s.embedding_dim)
        checks["embed_probe"] = {"ok": True, "dimensions": len(emb_probe.vectors[0])}
    except GeminiError as exc:
        checks["embed_probe"] = {"ok": False, "error": str(exc)[:300]}
    result.update(ok=checks["generate_probe"]["ok"] and checks["embed_probe"]["ok"], checks=checks, generate_models=gen[:40], embedding_models=emb)
    _DOCTOR = result
    return result


def prometheus(session: Session) -> str:
    lines = []

    def gauge(name: str, value: Any, labels: dict[str, str] | None = None, help_text: str = "") -> None:
        if help_text:
            lines.append(f"# HELP {name} {help_text}")
            lines.append(f"# TYPE {name} gauge")
        lab = "{" + ",".join(f'{k}="{v}"' for k, v in (labels or {}).items()) + "}" if labels else ""
        lines.append(f"{name}{lab} {float(value or 0)}")

    for r in fetch_all(session, "SELECT relationship_type, review_status, count(*) AS n FROM verse_resource_links WHERE parent_link_id IS NULL GROUP BY 1, 2"):
        gauge("ibible_mappings", r["n"], {"type": r["relationship_type"], "status": r["review_status"]})
    for r in fetch_all(session, "SELECT status, count(*) AS n FROM jobs GROUP BY status"):
        gauge("ibible_jobs", r["n"], {"status": r["status"]})
    for r in fetch_all(session, "SELECT status, count(*) AS n FROM processing_runs GROUP BY status"):
        gauge("ibible_processing_runs", r["n"], {"status": r["status"]})
    ai = fetch_one(session, "SELECT count(*) AS calls, coalesce(sum(cost_usd),0) AS cost FROM llm_calls WHERE created_at >= date_trunc('day', now())")
    gauge("ibible_llm_calls_today", ai["calls"])
    gauge("ibible_llm_cost_usd_today", ai["cost"])
    gauge("ibible_intelligence_cache_hits", cache.intelligence_cache.hits)
    gauge("ibible_intelligence_cache_misses", cache.intelligence_cache.misses)
    return "\n".join(lines) + "\n"

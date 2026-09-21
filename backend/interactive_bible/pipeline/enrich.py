"""Stages G (P-06 tags, P-07 summary), H (P-08 clip boundaries) and I (P-12 audit)."""
from __future__ import annotations

import logging
import re
from typing import Any

from ..ai.llm import AIInvalidOutput, AIUnavailable, get_llm
from ..ai.schemas import AuditOut, ClipOut, SummaryOut, TaggerOut
from ..bible import books as B
from ..vocab.data import ENTITIES, TOPICS
from ..vocab.service import deterministic_tags
from .detectors import passage_text, resolve_verse_id
from .types import Mapping, SegmentWork

log = logging.getLogger(__name__)
CLIP_MIN_MS, CLIP_TARGET_MIN_MS, CLIP_TARGET_MAX_MS, CLIP_MAX_MS = 15_000, 30_000, 120_000, 180_000
_TECHNICAL_REASON = re.compile(r"\d\s*ms\b|millisecond|\bunits?\b|start_ms|end_ms|timestamp", re.IGNORECASE)


def viewer_clip_reason(reason: str | None) -> str | None:
    """P-08's reason is shown to viewers under the clip; drop it when the model leaked timing internals."""
    text = " ".join((reason or "").split())
    if not text or _TECHNICAL_REASON.search(text):
        return None
    return text[:240]


def _topic_lookup() -> dict[str, str]:
    out: dict[str, str] = {}
    for slug, name, _cat, aliases in TOPICS:
        tid = f"topic_{slug}"
        for key in (slug, name, *aliases):
            out.setdefault(key.lower(), tid)
    return out


def _entity_lookup() -> dict[tuple[str, str], str]:
    out: dict[tuple[str, str], str] = {}
    for key, etype, name, aliases, _p, _l, _d in ENTITIES:
        for k in (key, name, *aliases):
            out.setdefault((etype, k.lower()), f"ent_{key}")
    return out


TYPE_FOR_FIELD = {"people": "person", "places": "place", "events": "event", "life_situations": "life_situation", "questions": "question"}


def tag_segment(seg: SegmentWork, resource: dict[str, Any], run_id: str, ai: bool) -> None:
    mapped = [m.start for m in seg.mappings if m.review_status != "discarded"]
    fallback = deterministic_tags(seg.text, mapped)
    if not ai:
        seg.tags = fallback
        seg.tags_provenance = {"source": "deterministic_vocab_tagger"}
        return
    topic_vocab = [name for _s, name, _c, _a in TOPICS]
    entity_vocab = {t: [name for _k, et, name, *_ in ENTITIES if et == t] for t in ("person", "place", "event", "life_situation", "question")}
    hints = list(resource.get("topic_hints") or [])
    try:
        result = get_llm().run(
            "P-06",
            {
                "segment_text": seg.text + (f"\n[resource topic hints: {', '.join(hints)}]" if hints else ""),
                "mapped_verses": [m.canonical for m in seg.mappings],
                "topic_vocab": topic_vocab, "entity_vocab": entity_vocab,
            },
            TaggerOut, resource_id=resource["id"], run_id=run_id,
        )
    except (AIUnavailable, AIInvalidOutput) as exc:
        seg.notes.append(f"P-06 unavailable: {exc}")
        seg.tags = fallback
        seg.tags_provenance = {"source": "deterministic_vocab_tagger", "degraded": True}
        return
    seg.ai_calls.append(result.provenance())
    topics = _topic_lookup()
    entities = _entity_lookup()
    tags: dict[str, list[dict[str, Any]]] = {"topics": []}
    for t in result.output.topics[:5]:
        tid = topics.get(t.name.lower().strip())
        if tid and all(x["id"] != tid for x in tags["topics"]):
            tags["topics"].append({"id": tid, "name": t.name, "confidence": round(min(0.95, t.confidence), 3)})
    for field_name, etype in TYPE_FOR_FIELD.items():
        tags[field_name] = []
        for t in getattr(result.output, field_name):
            eid = entities.get((etype, t.name.lower().strip()))
            if eid and all(x["id"] != eid for x in tags[field_name]):
                tags[field_name].append({"id": eid, "name": t.name, "confidence": round(min(0.95, t.confidence), 3)})
    seg.tags = tags
    seg.tags_provenance = {"source": "P-06", **result.provenance()}


def summarize_segment(seg: SegmentWork, resource: dict[str, Any], run_id: str, ai: bool) -> None:
    if not ai:
        return
    try:
        result = get_llm().run("P-07", {"segment_text": seg.text, "mappings": [m.canonical for m in seg.mappings]}, SummaryOut, resource_id=resource["id"], run_id=run_id)
    except (AIUnavailable, AIInvalidOutput) as exc:
        seg.notes.append(f"P-07 unavailable: {exc}")
        return
    seg.ai_calls.append(result.provenance())
    words = result.output.summary.strip().split()
    summary = " ".join(words[:28]) + ("…" if len(words) > 28 else "")
    seg.summary = summary
    seg.summary_provenance = result.provenance()


def _snap(value: int, options: list[int]) -> int:
    return min(options, key=lambda o: abs(o - value))


def select_clip(seg: SegmentWork, all_units: list[dict[str, Any]], resource: dict[str, Any], run_id: str, ai: bool) -> None:
    """Choose a playable clip range (CLIP-01..08). Virtual clip: seek/start/end on the original media."""
    if seg.start_ms is None or not seg.mappings:
        return
    primary = next((m for m in seg.mappings if m.primary), seg.mappings[0])
    times = [t for t in primary.evidence_times if t[0] is not None]
    core_start = min((t[0] for t in times), default=seg.start_ms)
    core_end = max((t[1] for t in times), default=seg.end_ms)
    seg_ids = set(seg.unit_ids)
    first = next(i for i, u in enumerate(all_units) if u["id"] in seg_ids)
    last = max(i for i, u in enumerate(all_units) if u["id"] in seg_ids)
    window = all_units[max(0, first - 3) : min(len(all_units), last + 4)]
    starts = [u["start_ms"] for u in window]
    ends = [u["end_ms"] for u in window]
    duration_total = resource.get("duration_ms") or ends[-1]

    def deterministic() -> dict[str, Any]:
        s_idx = max(0, next(i for i, u in enumerate(window) if u["end_ms"] > core_start) - 1)
        e_idx = min(len(window) - 1, max(i for i, u in enumerate(window) if u["start_ms"] < core_end) + 1)
        while window[e_idx]["end_ms"] - window[s_idx]["start_ms"] < CLIP_TARGET_MIN_MS and (s_idx > 0 or e_idx < len(window) - 1):
            if e_idx < len(window) - 1:
                e_idx += 1
            elif s_idx > 0:
                s_idx -= 1
        while window[e_idx]["end_ms"] - window[s_idx]["start_ms"] > CLIP_TARGET_MAX_MS and e_idx > s_idx:
            if window[e_idx]["start_ms"] >= core_end:
                e_idx -= 1
            elif window[s_idx]["end_ms"] <= core_start:
                s_idx += 1
            else:
                break
        return {"start_ms": window[s_idx]["start_ms"], "end_ms": window[e_idx]["end_ms"], "core_start_ms": core_start, "core_end_ms": core_end,
                "reason": None, "confidence": 0.75, "provenance": {"source": "deterministic_clip_rules", "rule": "sentence-aligned window around the primary evidence"}}

    clip = None
    if ai:
        payload = "\n".join(f"{u['id']} | {u['start_ms']} | {u['end_ms']} | {u['text']}" for u in window)
        try:
            result = get_llm().run(
                "P-08",
                {"units": payload, "evidence": primary.evidence_text, "verse": f"{primary.canonical} ({B.display_ref(primary.start, primary.end)})"},
                ClipOut, resource_id=resource["id"], run_id=run_id,
            )
            seg.ai_calls.append(result.provenance())
            o = result.output
            start = _snap(o.start_ms, starts)
            end = _snap(o.end_ms, ends)
            if abs(start - o.start_ms) <= 1500 and abs(end - o.end_ms) <= 1500 and CLIP_MIN_MS <= end - start <= CLIP_MAX_MS and start <= core_start and end >= core_end:
                clip = {"start_ms": start, "end_ms": end, "core_start_ms": max(start, min(o.core_start_ms, core_start)), "core_end_ms": min(end, max(o.core_end_ms, core_end)),
                        "reason": viewer_clip_reason(o.reason), "confidence": round(min(0.95, o.confidence), 3), "provenance": {"source": "P-08", **result.provenance()}}
            else:
                seg.notes.append("P-08 clip rejected by validation; using deterministic clip")
        except (AIUnavailable, AIInvalidOutput) as exc:
            seg.notes.append(f"P-08 unavailable: {exc}")
    clip = clip or deterministic()
    clip["start_ms"] = max(0, clip["start_ms"])
    clip["end_ms"] = min(duration_total, clip["end_ms"])
    seg.clip = clip


def audit_segment(seg: SegmentWork, resource: dict[str, Any], run_id: str, ai: bool) -> None:
    candidates = [m for m in seg.mappings]
    if not ai or not candidates:
        return
    try:
        result = get_llm().run(
            "P-12",
            {
                "segment_text": seg.text,
                "mappings": [{"verse": m.canonical, "type": m.type, "subtype": m.subtype, "confidence": m.confidence, "evidence": m.evidence_text[:300], "why_related": m.why_related} for m in candidates],
                "bible_texts": {m.canonical: passage_text(m.start, m.end, 4) for m in candidates},
            },
            AuditOut, resource_id=resource["id"], run_id=run_id,
        )
    except (AIUnavailable, AIInvalidOutput) as exc:
        seg.notes.append(f"P-12 unavailable: {exc}")
        for m in candidates:
            if m.type in ("ai_related", "contextual_reference"):
                m.review_reasons = sorted(set(m.review_reasons + ["audit_unavailable"]))
                m.needs_review = True
        return
    seg.ai_calls.append(result.provenance())

    def find(verse: str) -> Mapping | None:
        rng = resolve_verse_id(verse)
        if not rng:
            return None
        return next((m for m in candidates if (m.start, m.end) == rng), None) or next((m for m in candidates if m.start <= rng[0] <= m.end), None)

    decided: set[int] = set()
    for v in result.output.approved:
        m = find(v)
        if m:
            m.audit = {"decision": "approved"}
            decided.add(id(m))
    for issue in result.output.needs_review:
        m = find(issue.verse)
        if m:
            m.audit = {"decision": "needs_review", "reason": issue.reason}
            m.needs_review = True
            m.review_reasons = sorted(set(m.review_reasons + ["audit_needs_review"]))
            if m.type in ("ai_related", "contextual_reference"):
                m.confidence = min(m.confidence, 0.85)
            decided.add(id(m))
    for issue in result.output.rejected:
        m = find(issue.verse)
        if m:
            m.audit = {"decision": "rejected", "reason": issue.reason}
            decided.add(id(m))
            deterministic = m.type == "direct_reference" and "refparser" in m.detectors and m.confidence >= 0.95
            if deterministic:
                m.needs_review = True
                m.review_reasons = sorted(set(m.review_reasons + ["audit_disputed_explicit_reference"]))
            else:
                m.confidence = min(m.confidence, 0.6)
                m.review_reasons = sorted(set(m.review_reasons + ["audit_rejected"]))
    for m in candidates:
        if id(m) not in decided and m.type in ("ai_related", "contextual_reference"):
            m.needs_review = True
            m.review_reasons = sorted(set(m.review_reasons + ["audit_missing"]))

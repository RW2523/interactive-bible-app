"""Related Scripture (VERSE -> RELATED_TO -> VERSE) with grounded "Why related?" explanations (P-09) and verse enrichment (P-15)."""
from __future__ import annotations

import json
import logging
import math
from typing import Any

from sqlalchemy.orm import Session

from .. import cache, jobs
from ..ai.llm import AIInvalidOutput, AIUnavailable, get_llm
from ..ai.schemas import TaggerOut, WhyOut
from ..bible import books as B
from ..config import get_settings
from ..db import execute, fetch_all, fetch_one, json_dumps, session_scope
from ..pipeline.detectors import passage_text
from ..retrieval.semantic import verse_embedding_count, verse_neighbors
from ..security import Viewer, visibility_clause
from ..vocab.data import ENTITIES, TOPICS

log = logging.getLogger(__name__)
REL_LABELS = {
    "cross_reference": "Cross-reference", "thematic": "Thematic", "conceptual": "Conceptual", "narrative_parallel": "Narrative parallel",
    "question_answer": "Question & answer", "doctrinal_context": "Doctrinal context", "co_discussed": "Discussed together", "semantic_similarity": "AI Related",
}
SOURCE_WEIGHT = {"human": 1.0, "pipeline": 0.9, "openbible": 0.85, "embedding": 0.75}
MIN_EXPLANATION_CONFIDENCE = 0.65


def _template_why(rel: dict[str, Any]) -> str:
    ev = rel.get("evidence") or {}
    if rel["source"] == "openbible":
        return f"Listed as a cross-reference by {ev.get('votes', 'several')} OpenBible.info contributors."
    if rel["source"] == "co_discussed":
        titles = ev.get("titles") or []
        return f"Both passages are discussed together in {ev.get('segments', 1)} resource section(s)" + (f", e.g. “{titles[0]}”." if titles else ".")
    if rel["source"] == "pipeline" and ev.get("evidence_text"):
        return f"A resource connects them: “{ev['evidence_text'][:160]}”"
    return "Semantic similarity between the two passages."


def related_verses(session: Session, viewer: Viewer, start: int, end: int, limit: int = 12) -> list[dict[str, Any]]:
    rows = fetch_all(
        session,
        """SELECT id, from_verse_id, from_end_verse_id, to_verse_id, to_end_verse_id, relationship_type, source, confidence, explanation,
                  explanation_confidence, evidence, 'forward' AS direction
           FROM verse_relationships
           WHERE int4range(from_verse_id, coalesce(from_end_verse_id, from_verse_id), '[]') && int4range(:s, :e, '[]')
             AND review_status IN ('published', 'approved')
           UNION ALL
           SELECT id, to_verse_id, to_end_verse_id, from_verse_id, from_end_verse_id, relationship_type, source, confidence, explanation,
                  explanation_confidence, evidence, 'reverse'
           FROM verse_relationships
           WHERE int4range(to_verse_id, coalesce(to_end_verse_id, to_verse_id), '[]') && int4range(:s, :e, '[]')
             AND review_status IN ('published', 'approved') AND source IN ('pipeline', 'human')
           ORDER BY confidence DESC LIMIT 200""",
        s=start, e=end,
    )
    vis, params = visibility_clause(viewer, "r", discoverable=True)
    co = fetch_all(
        session,
        f"""SELECT l2.verse_id AS to_verse_id, l2.end_verse_id AS to_end_verse_id, count(DISTINCT l2.segment_id) AS segments,
                   max(least(l1.confidence, l2.confidence)) AS confidence, array_agg(DISTINCT r.title) AS titles,
                   (array_agg(l2.segment_id))[1] AS segment_id
            FROM verse_resource_links l1
            JOIN verse_resource_links l2 ON l2.segment_id = l1.segment_id AND l2.id <> l1.id
            JOIN resources r ON r.id = l1.resource_id
            WHERE int4range(l1.verse_id, coalesce(l1.end_verse_id, l1.verse_id), '[]') && int4range(:s, :e, '[]')
              AND NOT (int4range(l2.verse_id, coalesce(l2.end_verse_id, l2.verse_id), '[]') && int4range(:s, :e, '[]'))
              AND l1.parent_link_id IS NULL AND l2.parent_link_id IS NULL
              AND l1.review_status IN ('published', 'approved') AND l2.review_status IN ('published', 'approved')
              AND coalesce(l2.end_verse_id, l2.verse_id) - l2.verse_id <= 30 AND {vis}
            GROUP BY l2.verse_id, l2.end_verse_id ORDER BY segments DESC LIMIT 20""",
        s=start, e=end, **params,
    )
    merged: dict[tuple[int, int], dict[str, Any]] = {}

    def add(key: tuple[int, int], rel_type: str, source: str, score: float, why: str | None, why_conf: float | None, evidence: Any, rel_id: int | None) -> None:
        item = merged.setdefault(key, {"key": key, "sources": [], "score": 0.0, "why": None, "why_confidence": None, "relationship": rel_type, "relationship_ids": []})
        item["sources"].append({"source": source, "relationship": rel_type, "score": round(score, 3), "evidence": evidence})
        if rel_id:
            item["relationship_ids"].append(rel_id)
        if score > item["score"]:
            item["score"], item["relationship"] = score, rel_type
        if why and (item["why"] is None or (why_conf or 0) > (item["why_confidence"] or 0)):
            item["why"], item["why_confidence"] = why, why_conf

    for r in rows:
        grounded = r["explanation"] and (r["explanation_confidence"] or 0) >= MIN_EXPLANATION_CONFIDENCE
        if r["source"] == "embedding" and not grounded:
            continue  # unverified semantic neighbours are never shown
        if r["source"] == "pipeline" and r["explanation"] and not grounded:
            continue
        key = (r["to_verse_id"], r["to_end_verse_id"] or r["to_verse_id"])
        if key[0] <= end and key[1] >= start:
            continue
        score = float(r["confidence"]) * SOURCE_WEIGHT.get(r["source"], 0.7)
        ev = r["evidence"] if isinstance(r["evidence"], dict) else json.loads(r["evidence"] or "{}")
        # a weak AI explanation is never shown: the relationship keeps its evidence-based template instead
        add(key, r["relationship_type"], r["source"], score, r["explanation"] if grounded else None, r["explanation_confidence"] if grounded else None, ev, r["id"])
    for r in co:
        key = (r["to_verse_id"], r["to_end_verse_id"] or r["to_verse_id"])
        score = min(0.97, (0.7 + 0.08 * min(r["segments"], 3)) * float(r["confidence"]))
        add(key, "co_discussed", "co_discussed", score, None, None, {"segments": r["segments"], "titles": r["titles"][:3], "segment_id": r["segment_id"]}, None)
    ranked = sorted(merged.values(), key=lambda x: (-x["score"], x["key"][0]))[:limit]
    ids = [k for item in ranked for k in range(item["key"][0], min(item["key"][1], item["key"][0] + 3) + 1)]
    texts = {r["verse_id"]: r["text"] for r in fetch_all(session, "SELECT verse_id, text FROM bible_verse_texts WHERE verse_id = ANY(:ids) AND translation_id = :t", ids=ids, t=get_settings().default_translation)}
    out = []
    for item in ranked:
        s, e = item["key"]
        text = " ".join(texts.get(i, "") for i in range(s, min(e, s + 3) + 1) if texts.get(i))
        primary_source = max(item["sources"], key=lambda x: x["score"])
        why = item["why"]
        status = "ready" if why else ("pending" if get_llm().available else "template")
        out.append({
            "ref": B.canonical_range_str(s, e if e != s else None), "display_ref": B.display_ref(s, e if e != s else None), "text": text,
            "relationship": item["relationship"], "label": REL_LABELS.get(item["relationship"], item["relationship"]),
            "score": round(item["score"], 3), "why": why or _template_why({"source": primary_source["source"], "evidence": primary_source["evidence"]}),
            "why_status": status, "why_confidence": item["why_confidence"], "sources": [x["source"] for x in item["sources"]],
            "relationship_ids": item["relationship_ids"], "is_ai": item["relationship"] in ("thematic", "conceptual", "narrative_parallel", "question_answer", "doctrinal_context", "semantic_similarity"),
        })
    return out


def _explain(from_start: int, from_end: int, to_start: int, to_end: int, relationship: str, evidence: str) -> tuple[str, float, dict[str, Any]]:
    result = get_llm().run(
        "P-09",
        {
            "source_text_or_verse": f"{B.display_ref(from_start, from_end if from_end != from_start else None)}: {passage_text(from_start, from_end, 6)}",
            "target_verse_text": f"{B.display_ref(to_start, to_end if to_end != to_start else None)}: {passage_text(to_start, to_end, 6)}",
            "relationship_type": relationship, "evidence": evidence or "(no additional evidence)",
        },
        WhyOut,
    )
    return result.output.why_related.strip(), float(result.output.confidence), {"source": "P-09", **result.provenance()}


def explain_relationship(relationship_id: int) -> dict[str, Any]:
    with session_scope() as s:
        rel = fetch_one(s, "SELECT * FROM verse_relationships WHERE id = :id", id=relationship_id)
    if not rel:
        return {"skipped": "missing"}
    if rel["explanation"] and rel["source"] != "openbible":
        return {"skipped": "already explained"}
    if rel["explanation"]:
        return {"skipped": "already explained"}
    ev = rel["evidence"] or {}
    evidence = ev.get("evidence_text") or (f"{ev.get('votes')} people listed these passages as cross-references" if ev.get("votes") else "")
    why, conf, prov = _explain(rel["from_verse_id"], rel["from_end_verse_id"] or rel["from_verse_id"], rel["to_verse_id"], rel["to_end_verse_id"] or rel["to_verse_id"], rel["relationship_type"], evidence)
    with session_scope() as s:
        execute(s, "UPDATE verse_relationships SET explanation = :w, explanation_confidence = :c, explanation_provenance = CAST(:p AS jsonb), updated_at = now() WHERE id = :id",
                w=why, c=conf, p=json_dumps(prov), id=relationship_id)
        cache.bump_verses(s, [rel["from_verse_id"], rel["to_verse_id"]])
    return {"relationship_id": relationship_id, "confidence": conf}


def why_related_now(session: Session, viewer: Viewer, from_ref: tuple[int, int], to_ref: tuple[int, int], generate: bool = True) -> dict[str, Any]:
    """Explain a related passage: the stored explanation, else a new P-09 one when ``generate`` (else the evidence template)."""
    items = related_verses(session, viewer, from_ref[0], from_ref[1], limit=60)
    item = next((i for i in items if B.parse_canonical_range(i["ref"]) == to_ref), None)
    llm = get_llm()
    ai = generate and llm.available
    if item is None:
        if not ai:
            return {"why": None, "status": "unavailable", "grounded_in": []}
        why, conf, prov = _explain(from_ref[0], from_ref[1], to_ref[0], to_ref[1], "semantic_similarity", "")
        return {"why": why if conf >= MIN_EXPLANATION_CONFIDENCE else "The connection between these passages is weak based on their texts.", "confidence": conf, "status": "generated", "provenance": prov, "relationship": "semantic_similarity"}
    if item["why_status"] == "ready":
        return {"why": item["why"], "confidence": item["why_confidence"], "status": "ready", "relationship": item["relationship"], "sources": item["sources"]}
    if not ai:
        return {"why": item["why"], "confidence": None, "status": "template", "relationship": item["relationship"], "sources": item["sources"]}
    evidence = ""
    if "co_discussed" in item["sources"]:
        evidence = f"Both passages are discussed in the same resource section(s)."
    try:
        why, conf, prov = _explain(from_ref[0], from_ref[1], to_ref[0], to_ref[1], item["relationship"], evidence)
    except (AIUnavailable, AIInvalidOutput) as exc:
        return {"why": item["why"], "status": "template", "error": str(exc)[:200], "relationship": item["relationship"]}
    for rid in item["relationship_ids"]:
        execute(session, "UPDATE verse_relationships SET explanation = :w, explanation_confidence = :c, explanation_provenance = CAST(:p AS jsonb), updated_at = now() WHERE id = :id AND explanation IS NULL",
                w=why, c=conf, p=json_dumps(prov), id=rid)
    cache.bump_verses(session, [from_ref[0], to_ref[0]])
    if conf < MIN_EXPLANATION_CONFIDENCE:
        # not grounded well enough to show: keep the evidence-based description
        return {"why": item["why"], "confidence": conf, "status": "template", "relationship": item["relationship"], "sources": item["sources"], "note": "The AI could not ground a clear explanation in both passages."}
    return {"why": why, "confidence": conf, "status": "generated", "relationship": item["relationship"], "sources": item["sources"], "provenance": prov}


def enrich_verse(verse_id: int) -> dict[str, Any]:
    """Background enrichment for a verse opened in Advanced Read (P-15 themes, P-09 explanations, verified semantic neighbours)."""
    llm = get_llm()
    if not llm.available:
        return {"skipped": "AI not configured"}
    out: dict[str, Any] = {"verse_id": verse_id}
    code, ch, v = B.from_ordinal(verse_id)
    with session_scope() as s:
        has_topics = fetch_one(s, "SELECT count(*) AS n FROM verse_topics WHERE verse_id = :v", v=verse_id)["n"]
    if not has_topics:
        lo = B.ordinal(code, ch, max(1, v - 2))
        hi = B.ordinal(code, ch, min(B.verse_count(code, ch), v + 2))
        try:
            result = llm.run(
                "P-15",
                {
                    "verse_ref": B.ref_from_ordinal(verse_id), "verse_context": passage_text(lo, hi, 5),
                    "topic_vocab": [name for _s, name, _c, _a in TOPICS],
                    "entity_vocab": {t: [name for _k, et, name, *_ in ENTITIES if et == t] for t in ("person", "place", "event")},
                },
                TaggerOut,
            )
            topic_ids = {name.lower(): f"topic_{slug}" for slug, name, _c, _a in TOPICS}
            ent_ids = {(et, name.lower()): f"ent_{k}" for k, et, name, *_ in ENTITIES}
            with session_scope() as s:
                for t in result.output.topics[:5]:
                    tid = topic_ids.get(t.name.lower())
                    if tid:
                        execute(s, "INSERT INTO verse_topics (verse_id, topic_id, confidence, provenance) VALUES (:v, :t, :c, CAST(:p AS jsonb)) ON CONFLICT DO NOTHING",
                                v=verse_id, t=tid, c=min(0.9, t.confidence), p=json_dumps({"source": "ai_verse_tagger", **result.provenance()}))
                for field, et in (("people", "person"), ("places", "place"), ("events", "event")):
                    for t in getattr(result.output, field):
                        eid = ent_ids.get((et, t.name.lower()))
                        if eid:
                            execute(s, "INSERT INTO verse_entities (verse_id, entity_id, confidence, provenance) VALUES (:v, :e, :c, CAST(:p AS jsonb)) ON CONFLICT DO NOTHING",
                                    v=verse_id, e=eid, c=min(0.9, t.confidence), p=json_dumps({"source": "ai_verse_tagger", **result.provenance()}))
            out["themes"] = len(result.output.topics)
        except (AIUnavailable, AIInvalidOutput) as exc:
            out["themes_error"] = str(exc)[:200]
    # explain the strongest unexplained relationships
    with session_scope() as s:
        pending = fetch_all(s, """SELECT id FROM verse_relationships WHERE from_verse_id = :v AND explanation IS NULL AND review_status IN ('published','approved')
                                  ORDER BY confidence DESC LIMIT 6""", v=verse_id)
    explained = 0
    for row in pending:
        try:
            explain_relationship(row["id"])
            explained += 1
        except (AIUnavailable, AIInvalidOutput) as exc:
            out["explain_error"] = str(exc)[:200]
            break
    out["explained"] = explained
    # semantic neighbours, verified by P-09 before they are shown
    with session_scope() as s:
        if verse_embedding_count(s) > 1000:
            neighbours = verse_neighbors(s, verse_id, limit=8)
            existing = {r["to_verse_id"] for r in fetch_all(s, "SELECT to_verse_id FROM verse_relationships WHERE from_verse_id = :v", v=verse_id)}
        else:
            neighbours, existing = [], set()
    added = 0
    for other, sim in neighbours:
        ocode, och, ov = B.from_ordinal(other)
        if other in existing or (ocode == code and och == ch and abs(ov - v) <= 2) or sim < 0.6:
            continue
        try:
            why, conf, prov = _explain(verse_id, verse_id, other, other, "semantic_similarity", f"embedding cosine similarity {sim:.2f}")
        except (AIUnavailable, AIInvalidOutput):
            break
        with session_scope() as s:
            execute(s, """INSERT INTO verse_relationships (from_verse_id, to_verse_id, relationship_type, source, confidence, explanation, explanation_confidence,
                              explanation_provenance, evidence, provenance, review_status)
                          VALUES (:f, :t, 'semantic_similarity', 'embedding', :c, :w, :wc, CAST(:p AS jsonb), CAST(:ev AS jsonb), CAST(:pv AS jsonb), :st)
                          ON CONFLICT DO NOTHING""",
                    f=verse_id, t=other, c=round(min(0.9, sim), 3), w=why, wc=conf, p=json_dumps(prov), ev=json_dumps({"cosine": round(sim, 4)}),
                    pv=json_dumps({"source": "embedding", "model": get_settings().gemini_embed_model}),
                    st="published" if conf >= MIN_EXPLANATION_CONFIDENCE else "index_only")
        added += 1
        if added >= 4:
            break
    out["semantic_neighbours"] = added
    with session_scope() as s:
        cache.bump_verses(s, [verse_id])
    return out


def maybe_enqueue_enrichment(verse_id: int) -> None:
    if not get_llm().available:
        return
    try:
        with session_scope() as s:
            jobs.enqueue(s, "enrich_verse", {"verse_id": verse_id}, dedupe_key=f"enrich:{verse_id}", priority=50)
    except Exception:  # noqa: BLE001
        log.exception("could not enqueue enrichment")


def crossref_score(votes: int) -> float:
    return min(0.95, 0.5 + 0.45 * math.log10(max(votes, 1)) / 3.0)

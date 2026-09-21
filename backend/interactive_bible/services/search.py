"""Semantic Bible + resource search (spec §7): exact references, AI query parsing (P-10), hybrid retrieval, grounded re-ranking (P-11)."""
from __future__ import annotations

import re
import time
from typing import Any

from sqlalchemy.orm import Session

from .. import cache
from ..ai.llm import AIInvalidOutput, AIUnavailable, get_llm
from ..ai.schemas import RerankOut, SearchParseOut
from ..bible import books as B
from ..bible.refparser import find_query_references
from ..config import get_settings
from ..db import execute, fetch_all, json_dumps
from ..retrieval.semantic import fts_verse_candidates, keyword_terms, rrf, vector_literal, vector_verse_candidates, verse_embedding_count
from ..security import Viewer, visibility_clause
from ..vocab.data import ENTITIES, TOPICS
from ..vocab.service import load_entities, load_topics
from .cards import LINK_COLUMNS, build_card

RESOURCE_TYPE_WORDS = {
    "video": ["video", "videos", "watch", "clip", "clips"], "audio": ["audio", "podcast", "podcasts", "listen"], "sermon": ["sermon", "sermons", "preaching", "message", "messages"],
    "podcast": ["podcast", "podcasts"], "study": ["study", "studies", "bible study"], "devotional": ["devotional", "devotionals", "devotion"],
    "article": ["article", "articles", "blog"], "pdf": ["pdf", "pdfs"], "document": ["document", "documents", "notes"],
}
TYPE_FILTER = {"video": ("type", "video"), "audio": ("type", "audio"), "pdf": ("type", "pdf"), "document": ("type", "document"), "sermon": ("category", "sermon"),
               "podcast": ("category", "podcast"), "study": ("category", "study"), "devotional": ("category", "devotional"), "article": ("category", "article")}


def deterministic_parse(query: str) -> dict[str, Any]:
    refs = find_query_references(query)
    low = query.lower()
    types = [t for t, words in RESOURCE_TYPE_WORDS.items() if any(re.search(rf"\b{re.escape(w)}\b", low) for w in words)]
    topics = [name for _tid, slug, name, aliases in load_topics() if any(re.search(rf"\b{re.escape(a)}\b", low) for a in (slug.replace("-", " "), name.lower(), *aliases))]
    entities = [e.name for e in load_entities() if e.type in ("person", "event", "place") and any(re.search(rf"\b{re.escape(a)}\b", low) for a in e.aliases)]
    semantic = query
    for r in refs:
        semantic = semantic.replace(r.raw_text, " ")
    for words in RESOURCE_TYPE_WORDS.values():
        for w in words:
            semantic = re.sub(rf"\b(show|find|list)?\s*{re.escape(w)}\b", " ", semantic, flags=re.IGNORECASE)
    semantic = re.sub(r"\s+", " ", semantic).strip(" ?.,")
    scope = "resources" if types else ("both")
    return {"explicit_refs": [r.canonical for r in refs], "topics": topics[:5], "entities": entities[:5], "resource_types": types, "semantic_query": semantic or query, "search_scope": scope, "parser": "deterministic"}


def parse_query(query: str) -> dict[str, Any]:
    base = deterministic_parse(query)
    llm = get_llm()
    if not llm.available:
        return base
    try:
        result = llm.run("P-10", {"query": query, "locale": "en", "topic_vocab": [n for _s, n, _c, _a in TOPICS], "entity_vocab": [e[2] for e in ENTITIES if e[1] in ("person", "event", "place")]}, SearchParseOut)
    except (AIUnavailable, AIInvalidOutput):
        return base
    out = result.output
    # explicit references must be typed by the user, so they come only from the deterministic parser (never invented by the model)
    refs = list(base["explicit_refs"])
    types = sorted(set(base["resource_types"]) | {t for t in out.resource_types if t in TYPE_FILTER})
    return {
        "explicit_refs": refs, "topics": sorted(set(base["topics"]) | set(out.topics))[:6], "entities": sorted(set(base["entities"]) | set(out.entities))[:6],
        "resource_types": types, "semantic_query": out.semantic_query or base["semantic_query"], "search_scope": out.search_scope if not types else "resources",
        "parser": "P-10", "provenance": result.provenance(),
    }


def search(session: Session, viewer: Viewer, query: str, scope: str | None, filters: dict[str, Any], translation: str, limit: int) -> dict[str, Any]:
    t0 = time.monotonic()
    query = query.strip()[:500]
    from .bible import resolve_translation

    translation = resolve_translation(session, translation)
    version = cache.search_version(session)
    key = ("search", query.lower(), scope, json_dumps(filters), translation, viewer.scope_key, version, limit)
    hit = cache.search_cache.get(key)
    if hit:
        return {**hit, "cache": "hit", "latency_ms": int((time.monotonic() - t0) * 1000)}
    parsed = parse_query(query)
    scope = scope or parsed["search_scope"]
    llm = get_llm()
    settings = get_settings()
    ref_ranges = [B.parse_canonical_range(r) for r in parsed["explicit_refs"]]
    ref_ranges = [r for r in ref_ranges if r]
    sem_text = parsed["semantic_query"] or query
    qvec = None
    if llm.available and sem_text and (not ref_ranges or len(sem_text.split()) > 2):
        try:
            vecs, _ = llm.embed([sem_text], "RETRIEVAL_QUERY")
            qvec = vecs[0]
        except AIUnavailable:
            qvec = None

    # ------------------------------------------------ verses
    verses: list[dict[str, Any]] = []
    if scope in ("bible", "both"):
        scores: dict[int, dict[str, Any]] = {}

        def bump(vid: int, score: float, reason: str, match: str) -> None:
            item = scores.setdefault(vid, {"score": 0.0, "reasons": [], "match_types": set()})
            item["score"] += score
            if reason not in item["reasons"]:
                item["reasons"].append(reason)
            item["match_types"].add(match)

        for s, e in ref_ranges:
            for i, vid in enumerate(range(s, e + 1)):
                if B.is_valid(*B.from_ordinal(vid)):
                    bump(vid, 1.0 - min(i, 20) * 0.005, "Exact reference match", "exact_reference")
        vec_hits = vector_verse_candidates(session, qvec, 40) if qvec is not None and verse_embedding_count(session) > 0 else []
        fts_hits = fts_verse_candidates(session, sem_text, 40, translation) if keyword_terms(sem_text) else []
        for rank, (vid, sim) in enumerate(vec_hits):
            bump(vid, 0.55 * max(0.0, sim) + 0.25 / (rank + 1), f"Semantic match ({sim:.2f})", "semantic")
        for rank, (vid, sc) in enumerate(fts_hits):
            if sc >= 1.0:
                bump(vid, 0.3 / (rank + 1) + 0.12, "Keyword match (all terms)", "keyword")
            elif sc >= 0.5:
                bump(vid, 0.12, "Keyword match", "keyword")
            else:
                bump(vid, 0.08 / (rank + 1), "Keyword match", "keyword")
        topic_names = {n.lower() for n in parsed["topics"]}
        if topic_names:
            for r in fetch_all(session, """SELECT vt.verse_id, max(vt.confidence) AS c, bool_or(vt.provenance->>'source' = 'curated_topic_index') AS curated
                                          FROM verse_topics vt JOIN topics t ON t.id = vt.topic_id
                                          WHERE lower(t.name) = ANY(:names) GROUP BY vt.verse_id ORDER BY c DESC LIMIT 40""", names=list(topic_names)):
                bump(r["verse_id"], 0.4 * float(r["c"]), "Key verse for this theme" if r["curated"] else "Tagged with a matching theme", "theme")
        entity_ranges = [p for e in load_entities() if e.name in parsed["entities"] for p in e.passages]
        for vid in list(scores):
            if any(s <= vid <= e for s, e in entity_ranges):
                bump(vid, 0.08, "Within a passage about " + ", ".join(parsed["entities"][:2]), "entity")
        vis, params = visibility_clause(viewer, "r", discoverable=True)
        if scores:
            for r in fetch_all(session, f"""SELECT l.verse_id, bool_or(l.is_human_verified) AS human, bool_or(l.relationship_type IN ('direct_reference','scripture_quote')) AS explicit
                                           FROM verse_resource_links l JOIN resources r ON r.id = l.resource_id
                                           WHERE l.verse_id = ANY(:ids) AND l.review_status IN ('published','approved') AND {vis} GROUP BY l.verse_id""", ids=list(scores), **params):
                if r["explicit"]:
                    bump(r["verse_id"], 0.04, "Explained in library resources", "resources")
                if r["human"]:
                    bump(r["verse_id"], 0.03, "Human-verified mappings", "human_verified")
        top = sorted(scores.items(), key=lambda kv: -kv[1]["score"])[: max(limit, 20)]
        texts = {r["verse_id"]: r["text"] for r in fetch_all(session, "SELECT verse_id, text FROM bible_verse_texts WHERE verse_id = ANY(:ids) AND translation_id = :t", ids=[v for v, _ in top], t=translation)}
        verses = [{"id": f"verse:{B.ref_from_ordinal(v)}", "ref": B.ref_from_ordinal(v), "display_ref": B.display_ref(v), "text": texts.get(v, ""), "score": round(d["score"], 4),
                   "reasons": d["reasons"][:3], "match_types": sorted(d["match_types"])} for v, d in top]

    # ------------------------------------------------ resource segments
    segments: list[dict[str, Any]] = []
    if scope in ("resources", "both"):
        vis, params = visibility_clause(viewer, "r", discoverable=True)
        type_clauses = []
        for t in (filters.get("resource_types") or parsed["resource_types"]):
            if t in TYPE_FILTER:
                col, val = TYPE_FILTER[t]
                type_clauses.append(f"r.{col} = '{val}'")
        type_sql = f"AND ({' OR '.join(type_clauses)})" if type_clauses else ""
        seg_scores: dict[str, dict[str, Any]] = {}
        rows_by_seg: dict[str, dict[str, Any]] = {}

        def sbump(row: dict[str, Any], score: float, reason: str) -> None:
            sid = row["segment_id"]
            item = seg_scores.setdefault(sid, {"score": 0.0, "reasons": []})
            item["score"] += score
            if reason not in item["reasons"]:
                item["reasons"].append(reason)
            cur = rows_by_seg.get(sid)
            if cur is None or (row.get("mapping_id") and not cur.get("mapping_id")):
                rows_by_seg[sid] = row

        statuses = "('published','approved','index_only')"
        for s, e in ref_ranges:
            for row in fetch_all(session, f"""SELECT {LINK_COLUMNS} FROM verse_resource_links l JOIN resource_segments s ON s.id = l.segment_id JOIN resources r ON r.id = l.resource_id
                                             WHERE int4range(l.verse_id, coalesce(l.end_verse_id, l.verse_id), '[]') && int4range(:s, :e, '[]') AND l.review_status IN {statuses}
                                               AND l.parent_link_id IS NULL AND {vis} {type_sql}""", s=s, e=e, **params):
                weight = {"direct_reference": 0.9, "scripture_quote": 0.8, "contextual_reference": 0.6, "ai_related": 0.5}[row["relationship_type"]] * float(row["confidence"])
                if row["review_status"] == "index_only":
                    weight *= 0.5
                sbump(row, weight + (0.1 if row["is_human_verified"] else 0), f"{'Direct mention' if row['relationship_type'] == 'direct_reference' else row['relationship_type'].replace('_', ' ').capitalize()} of {B.display_ref(row['verse_id'], row['end_verse_id'])}")
        if len(ref_ranges) > 1:
            for sid, item in seg_scores.items():
                row = rows_by_seg[sid]
                covered = fetch_all(session, "SELECT DISTINCT verse_id, coalesce(end_verse_id, verse_id) AS e FROM verse_resource_links WHERE segment_id = :s AND review_status IN ('published','approved','index_only')", s=sid)
                both = all(any(c["verse_id"] <= s2 and c["e"] >= s1 for c in covered) for s1, s2 in ref_ranges)
                if both:
                    item["score"] += 0.6
                    item["reasons"].insert(0, "Discusses all the passages in your query")
        base_seg_sql = f"""SELECT s.id AS segment_id, s.ordinal AS segment_ordinal, s.start_ms, s.end_ms, s.page_start, s.page_end, s.heading, s.summary, s.speaker AS segment_speaker,
                              left(s.text_normalized, 400) AS excerpt, s.clip_start_ms, s.clip_end_ms, s.clip_core_start_ms, s.clip_core_end_ms, s.clip_review_status,
                              r.id AS resource_id, r.title, r.type AS resource_type, r.category, r.speaker, r.author, r.duration_ms, r.page_count, r.is_official, r.visibility,
                              r.rights_status, r.language, r.source_kind, r.series, r.created_at AS resource_created_at"""
        if qvec is not None:
            execute(session, "SET LOCAL hnsw.ef_search = 100")
            for row in fetch_all(session, f"""{base_seg_sql}, 1 - (e.embedding <=> CAST(:v AS vector)) AS sim
                                             FROM segment_embeddings e JOIN resource_segments s ON s.id = e.segment_id JOIN resources r ON r.id = s.resource_id
                                             WHERE e.purpose = 'document' AND e.model = :m AND s.is_active AND {vis} {type_sql}
                                             ORDER BY e.embedding <=> CAST(:v AS vector) LIMIT 30""", v=vector_literal(qvec), m=settings.gemini_embed_model, **params):
                if row["sim"] >= 0.5:
                    sbump(row, 0.7 * float(row["sim"]), f"Semantic match ({float(row['sim']):.2f})")
        terms = keyword_terms(sem_text)
        if terms:
            for rank, row in enumerate(fetch_all(session, f"""{base_seg_sql}, ts_rank_cd(s.tsv, q, 32) AS kw
                                                            FROM resource_segments s JOIN resources r ON r.id = s.resource_id, to_tsquery('english', :q) q
                                                            WHERE s.tsv @@ q AND s.is_active AND {vis} {type_sql} ORDER BY kw DESC LIMIT 30""", q=" | ".join(terms), **params)):
                sbump(row, 0.25 / (rank + 1) + min(0.2, float(row["kw"])), "Keyword match")
        topic_names = [n.lower() for n in parsed["topics"]]
        if topic_names:
            for row in fetch_all(session, f"""{base_seg_sql}, max(st.confidence) AS tc FROM segment_topics st JOIN topics t ON t.id = st.topic_id
                                             JOIN resource_segments s ON s.id = st.segment_id JOIN resources r ON r.id = s.resource_id
                                             WHERE lower(t.name) = ANY(:names) AND s.is_active AND {vis} {type_sql}
                                             GROUP BY s.id, r.id LIMIT 40""", names=topic_names, **params):
                sbump(row, 0.2 * float(row["tc"]), "About " + ", ".join(parsed["topics"][:2]))
        ranked = sorted(seg_scores.items(), key=lambda kv: -kv[1]["score"])[: max(limit, 20)]
        for sid, item in ranked:
            row = rows_by_seg[sid]
            if row.get("mapping_id"):
                card = build_card(row)
            else:
                card = _segment_card(session, viewer, row)
            card["score"] = round(item["score"], 4)
            card["reasons"] = item["reasons"][:3]
            card["id"] = f"segment:{sid}"
            segments.append(card)

    reranked = False
    if llm.available and (verses or segments) and not filters.get("no_rerank"):
        candidates = [{"id": v["id"], "kind": "verse", "ref": v["display_ref"], "text": v["text"][:300], "signals": v["reasons"]} for v in verses[:12]] + \
                     [{"id": s["id"], "kind": "resource_segment", "title": s["resource"]["title"], "type": s["resource"]["type"], "summary": s.get("summary") or (s.get("excerpt") or "")[:300],
                       "mapped_verse": s.get("verse_display"), "relationship": (s.get("relationship") or {}).get("label"), "signals": s["reasons"]} for s in segments[:12]]
        try:
            result = llm.run("P-11", {"query": query, "candidates": candidates}, RerankOut)
            order = {x.id: (x.score, x.reason) for x in result.output.ranked}
            for coll in (verses, segments):
                for item in coll:
                    if item["id"] in order:
                        score, reason = order[item["id"]]
                        item["rerank_score"] = round(score, 3)
                        if reason:
                            item["reasons"] = [reason] + [r for r in item["reasons"] if r != reason][:2]
                        item["score"] = round(0.6 * score + 0.4 * min(1.0, item["score"]), 4)
                coll.sort(key=lambda x: -x["score"])
            reranked = True
        except (AIUnavailable, AIInvalidOutput):
            reranked = False

    explanation = _explain(parsed, len(verses), len(segments))
    out = {
        "query": query, "parsed": parsed, "scope": scope, "verses": verses[:limit], "segments": segments[:limit], "explanation": explanation,
        "reranked": reranked, "semantic": qvec is not None, "cache": "miss", "latency_ms": int((time.monotonic() - t0) * 1000),
    }
    cache.search_cache.set(key, out)
    execute(session, "INSERT INTO search_logs (query, parsed, result_count, latency_ms, user_id) VALUES (:q, CAST(:p AS jsonb), :n, :l, :u)",
            q=query, p=json_dumps(parsed), n=len(verses) + len(segments), l=out["latency_ms"], u=viewer.user_id)
    return out


def _segment_card(session: Session, viewer: Viewer, row: dict[str, Any]) -> dict[str, Any]:
    from .cards import media_kind

    best = fetch_all(session, "SELECT verse_id, end_verse_id, relationship_type FROM verse_resource_links WHERE segment_id = :s AND review_status IN ('published','approved') AND parent_link_id IS NULL ORDER BY primary_flag DESC, confidence DESC LIMIT 1", s=row["segment_id"])
    return {
        "segment_id": row["segment_id"], "mapping_id": None, "media_kind": media_kind(row["resource_type"]),
        "resource": {"id": row["resource_id"], "title": row["title"], "type": row["resource_type"], "category": row["category"], "speaker": row["speaker"] or row.get("segment_speaker"),
                     "author": row["author"], "duration_ms": row["duration_ms"], "page_count": row["page_count"], "is_official": row["is_official"], "visibility": row["visibility"], "language": row["language"]},
        "segment": {"ordinal": row["segment_ordinal"], "start_ms": row["start_ms"], "end_ms": row["end_ms"], "page_start": row["page_start"], "page_end": row["page_end"], "heading": row["heading"]},
        "clip": {"start_ms": row["clip_start_ms"] if row["clip_start_ms"] is not None else row["start_ms"], "end_ms": row["clip_end_ms"] if row["clip_end_ms"] is not None else row["end_ms"]} if row["start_ms"] is not None else None,
        "summary": row["summary"], "excerpt": row["excerpt"], "evidence_text": None, "why_related": None, "relationship": None,
        "verse_ref": B.canonical_range_str(best[0]["verse_id"], best[0]["end_verse_id"]) if best else None,
        "verse_display": B.display_ref(best[0]["verse_id"], best[0]["end_verse_id"]) if best else None,
    }


def _explain(parsed: dict[str, Any], n_verses: int, n_segments: int) -> str:
    parts = []
    if parsed["explicit_refs"]:
        parts.append("matched the reference" + ("s " if len(parsed["explicit_refs"]) > 1 else " ") + ", ".join(B.display_ref(*B.parse_canonical_range(r)) for r in parsed["explicit_refs"] if B.parse_canonical_range(r)))
    if parsed["topics"]:
        parts.append("looked for the themes " + ", ".join(parsed["topics"]))
    if parsed["entities"]:
        parts.append("considered " + ", ".join(parsed["entities"]))
    if parsed["resource_types"]:
        parts.append("limited resources to " + ", ".join(parsed["resource_types"]))
    if parsed.get("semantic_query"):
        parts.append(f"searched for the meaning “{parsed['semantic_query']}”")
    head = "I " + "; ".join(parts) if parts else "I searched Scripture and resources"
    return f"{head}. Found {n_verses} verse(s) and {n_segments} resource section(s). Results are ranked by explicit Scripture evidence first, then semantic relevance."

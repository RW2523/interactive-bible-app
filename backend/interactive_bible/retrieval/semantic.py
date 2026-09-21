"""Hybrid verse/segment retrieval: pgvector cosine search + PostgreSQL full-text (keyword) + RRF fusion."""
from __future__ import annotations

import re
from collections import Counter
from typing import Iterable, Sequence

from sqlalchemy.orm import Session

from ..bible.text import STOPWORDS
from ..config import get_settings
from ..db import execute, fetch_all, fetch_one

COMMON_BIBLE_WORDS = {
    "god", "lord", "jesus", "christ", "said", "say", "says", "man", "men", "people", "day", "days", "come", "came", "go",
    "went", "israel", "king", "son", "sons", "one", "will", "shall", "things", "thing", "know", "make", "made", "give",
    "gave", "take", "took", "house", "land", "hand", "father", "children", "word", "words", "saying", "went", "also",
    "unto", "upon", "thee", "thou", "thy", "hath", "ye", "yes", "really", "going", "gonna", "want", "just", "like",
    "today", "right", "okay", "little", "lot", "get", "got", "think", "thought", "tell", "told", "look", "see",
    "way", "time", "life", "good", "great", "friends", "church", "sermon", "verse", "verses", "chapter", "bible",
    "scripture", "passage", "read", "reading", "talk", "talking", "let", "us", "we", "our", "you", "your", "him", "his",
}


def vector_literal(vec: Sequence[float]) -> str:
    return "[" + ",".join(f"{x:.6f}" for x in vec) + "]"


def keyword_terms(text: str, max_terms: int = 14) -> list[str]:
    words = [w.lower() for w in re.findall(r"[A-Za-z]{3,}", text)]
    counts = Counter(w for w in words if w not in STOPWORDS and w not in COMMON_BIBLE_WORDS)
    ranked = sorted(counts.items(), key=lambda kv: (-kv[1], -len(kv[0])))
    return [w for w, _ in ranked[:max_terms]]


def fts_verse_candidates(session: Session, text: str, limit: int = 40, translation: str | None = None) -> list[tuple[int, float]]:
    """Keyword candidates: verses matching all salient terms first (AND), then any term (OR, down-weighted)."""
    terms = keyword_terms(text)
    if not terms:
        return []
    translation = translation or get_settings().default_translation
    sql = """SELECT verse_id, ts_rank_cd(tsv, q, 32) AS score
             FROM bible_verse_texts, to_tsquery('english', :q) q
             WHERE translation_id = :t AND tsv @@ q
             ORDER BY score DESC LIMIT :limit"""
    results: dict[int, float] = {}
    if len(terms) >= 2:
        for r in fetch_all(session, sql, q=" & ".join(terms[:4]), t=translation, limit=limit):
            results[r["verse_id"]] = 1.0 + float(r["score"])
        if len(results) < limit // 2 and len(terms) >= 3:
            for i in range(min(3, len(terms))):
                for j in range(i + 1, min(4, len(terms))):
                    for r in fetch_all(session, sql, q=f"{terms[i]} & {terms[j]}", t=translation, limit=10):
                        results.setdefault(r["verse_id"], 0.5 + float(r["score"]))
    if len(results) < limit:
        for r in fetch_all(session, sql, q=" | ".join(terms), t=translation, limit=limit):
            results.setdefault(r["verse_id"], float(r["score"]))
    return sorted(results.items(), key=lambda kv: -kv[1])[:limit]


def verse_embedding_count(session: Session, model: str | None = None) -> int:
    model = model or get_settings().gemini_embed_model
    row = fetch_one(session, "SELECT count(*) AS n FROM verse_embeddings WHERE model = :m", m=model)
    return int(row["n"]) if row else 0


def vector_verse_candidates(session: Session, vector: Sequence[float], limit: int = 40, model: str | None = None) -> list[tuple[int, float]]:
    model = model or get_settings().gemini_embed_model
    execute(session, "SET LOCAL hnsw.ef_search = 120")
    rows = fetch_all(
        session,
        """SELECT verse_id, 1 - (embedding <=> CAST(:v AS vector)) AS sim
           FROM verse_embeddings WHERE model = :m
           ORDER BY embedding <=> CAST(:v AS vector) LIMIT :limit""",
        v=vector_literal(vector), m=model, limit=limit,
    )
    return [(r["verse_id"], float(r["sim"])) for r in rows]


def verse_neighbors(session: Session, verse_id: int, limit: int = 12, model: str | None = None) -> list[tuple[int, float]]:
    model = model or get_settings().gemini_embed_model
    execute(session, "SET LOCAL hnsw.ef_search = 120")
    rows = fetch_all(
        session,
        """SELECT e.verse_id, 1 - (e.embedding <=> src.embedding) AS sim
           FROM verse_embeddings src
           JOIN LATERAL (
               SELECT verse_id, embedding FROM verse_embeddings
               WHERE model = :m ORDER BY embedding <=> src.embedding LIMIT :limit
           ) e ON true
           WHERE src.verse_id = :vid AND src.model = :m AND e.verse_id <> :vid""",
        vid=verse_id, m=model, limit=limit + 1,
    )
    return [(r["verse_id"], float(r["sim"])) for r in rows]


def rrf(rankings: Iterable[Sequence[int]], k: int = 60, weights: Sequence[float] | None = None) -> list[tuple[int, float]]:
    scores: dict[int, float] = {}
    for idx, ranking in enumerate(rankings):
        w = weights[idx] if weights else 1.0
        for rank, item in enumerate(ranking):
            scores[item] = scores.get(item, 0.0) + w / (k + rank + 1)
    return sorted(scores.items(), key=lambda kv: -kv[1])

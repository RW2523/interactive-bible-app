"""Lexical Scripture quotation / paraphrase candidate index (spec ING-07, stage D).

All supported translations (WEB, KJV, ASV) are indexed as normalised word 3-gram shingles
(archaic forms mapped, light stemming) with IDF weights, so a quotation in any of those
wordings - or a close modern paraphrase sharing distinctive phrases - scores a high
idf-weighted *containment* (share of the verse's shingle weight present in the text).
Very short verses ("Jesus wept.") are matched as exact normalised phrases.
"""
from __future__ import annotations

import logging
import math
import threading
import time
import zlib
from dataclasses import dataclass

import numpy as np
from sqlalchemy.orm import Session

from ..bible.text import is_stop, match_tokens
from ..db import fetch_all

log = logging.getLogger(__name__)
K = 3
MAX_DF = 2000  # shingles present in more verses than this carry no quote evidence


def _h64(s: str) -> int:
    b = s.encode()
    return (zlib.crc32(b) << 32) | zlib.adler32(b)


@dataclass
class QuoteCandidate:
    verse_id: int
    translation_id: str
    containment: float
    matched: int
    verse_shingles: int
    longest_run: int
    start: int
    end: int
    evidence: str
    kind: str  # shingle | short_exact

    def to_dict(self) -> dict:
        return {
            "verse_id": self.verse_id, "translation_id": self.translation_id, "containment": round(self.containment, 3),
            "matched": self.matched, "verse_shingles": self.verse_shingles, "longest_run": self.longest_run,
            "start": self.start, "end": self.end, "evidence": self.evidence, "kind": self.kind,
        }


def _shingles(tokens: list[str]) -> list[tuple[int, int]]:
    out = []
    for i in range(len(tokens) - K + 1):
        a, b, c = tokens[i], tokens[i + 1], tokens[i + 2]
        if is_stop(a) and is_stop(b) and is_stop(c):
            continue
        out.append((_h64(f"{a} {b} {c}"), i))
    return out


class QuoteIndex:
    def __init__(self) -> None:
        self.translations: list[str] = []
        self.doc_verse = np.zeros(0, dtype=np.int32)
        self.doc_trans = np.zeros(0, dtype=np.int8)
        self.doc_weight = np.zeros(0, dtype=np.float64)
        self.doc_count = np.zeros(0, dtype=np.int32)
        self.doc_text: list[str] = []
        self.uh = np.zeros(0, dtype=np.uint64)
        self.u_start = np.zeros(0, dtype=np.int64)
        self.u_end = np.zeros(0, dtype=np.int64)
        self.u_idf = np.zeros(0, dtype=np.float64)
        self.u_df = np.zeros(0, dtype=np.int64)
        self.docs_sorted = np.zeros(0, dtype=np.int32)
        self.short: dict[tuple[str, ...], list[int]] = {}
        self.n_verses = 0

    # ------------------------------------------------------------------ build
    @classmethod
    def build(cls, rows: list[tuple[int, str, str]]) -> "QuoteIndex":
        t0 = time.time()
        idx = cls()
        trans_ids = sorted({r[1] for r in rows})
        idx.translations = trans_ids
        tmap = {t: i for i, t in enumerate(trans_ids)}
        hashes: list[int] = []
        docs: list[int] = []
        doc_verse, doc_trans, doc_count = [], [], []
        for d, (verse_id, trans, text) in enumerate(rows):
            toks = [t for t, _, _ in match_tokens(text)]
            sh = {h for h, _ in _shingles(toks)}
            hashes.extend(sh)
            docs.extend([d] * len(sh))
            doc_verse.append(verse_id)
            doc_trans.append(tmap[trans])
            doc_count.append(len(sh))
            idx.doc_text.append(text)
            content = [t for t in toks if not is_stop(t)]
            if 2 <= len(toks) <= 5 and len(content) >= 2:
                idx.short.setdefault(tuple(toks), []).append(d)
        idx.doc_verse = np.array(doc_verse, dtype=np.int32)
        idx.doc_trans = np.array(doc_trans, dtype=np.int8)
        idx.doc_count = np.array(doc_count, dtype=np.int32)
        idx.n_verses = len(set(doc_verse))

        H = np.array(hashes, dtype=np.uint64)
        D = np.array(docs, dtype=np.int32)
        V = idx.doc_verse[D]
        order = np.lexsort((V, H))
        H2, V2 = H[order], V[order]
        first_pair = np.ones(len(H2), dtype=bool)
        first_pair[1:] = (H2[1:] != H2[:-1]) | (V2[1:] != V2[:-1])
        uh, df = np.unique(H2[first_pair], return_counts=True)
        order2 = np.argsort(H, kind="stable")
        idx.docs_sorted = D[order2]
        H_sorted = H[order2]
        idx.uh = uh
        idx.u_start = np.searchsorted(H_sorted, uh, side="left")
        idx.u_end = np.searchsorted(H_sorted, uh, side="right")
        idx.u_df = df
        idx.u_idf = np.log1p(idx.n_verses / df.astype(np.float64))
        entry_idf = idx.u_idf[np.searchsorted(uh, H_sorted)]
        idx.doc_weight = np.bincount(idx.docs_sorted, weights=entry_idf, minlength=len(rows))
        log.info("quote index built: %d docs, %d shingles, %.1fs", len(rows), len(uh), time.time() - t0)
        return idx

    # ------------------------------------------------------------------ search
    def search(self, text: str, min_containment: float = 0.3, min_matched: int = 2, limit: int = 25) -> list[QuoteCandidate]:
        toks = match_tokens(text)
        words = [t for t, _, _ in toks]
        results: dict[int, QuoteCandidate] = {}

        q = _shingles(words)
        if q:
            q_hash = np.array(sorted({h for h, _ in q}), dtype=np.uint64)
            pos = np.searchsorted(self.uh, q_hash)
            pos_ok = pos < len(self.uh)
            valid = np.zeros(len(q_hash), dtype=bool)
            valid[pos_ok] = self.uh[pos[pos_ok]] == q_hash[pos_ok]
            upos = pos[valid]
            upos = upos[self.u_df[upos] <= MAX_DF]
            if len(upos):
                lengths = self.u_end[upos] - self.u_start[upos]
                entries = np.concatenate([np.arange(s, e) for s, e in zip(self.u_start[upos], self.u_end[upos])])
                docs = self.docs_sorted[entries]
                weights = np.repeat(self.u_idf[upos], lengths)
                n_docs = len(self.doc_verse)
                score = np.bincount(docs, weights=weights, minlength=n_docs)
                count = np.bincount(docs, minlength=n_docs)
                with np.errstate(divide="ignore", invalid="ignore"):
                    containment = np.where(self.doc_weight > 0, score / self.doc_weight, 0.0)
                cand = np.nonzero((containment >= min_containment) & (count >= min_matched))[0]
                # best translation per verse
                best: dict[int, int] = {}
                for d in cand:
                    v = int(self.doc_verse[d])
                    if v not in best or containment[d] > containment[best[v]]:
                        best[v] = int(d)
                ranked = sorted(best.values(), key=lambda d: (-containment[d], -count[d]))[: limit * 2]
                q_positions: dict[int, list[int]] = {}
                for h, i in q:
                    q_positions.setdefault(h, []).append(i)
                for d in ranked:
                    doc_toks = [t for t, _, _ in match_tokens(self.doc_text[d])]
                    doc_sh = {h for h, _ in _shingles(doc_toks)}
                    positions = sorted(i for h in doc_sh for i in q_positions.get(h, []))
                    if not positions:
                        continue
                    cluster = _densest_cluster(positions, gap=6)
                    s_tok, e_tok = cluster[0], min(cluster[-1] + K - 1, len(toks) - 1)
                    # true contiguous token overlap (stopwords included) around the cluster
                    lo, hi = max(0, s_tok - 4), min(len(words), e_tok + 5)
                    run_len, run_start = _longest_common_run(words[lo:hi], doc_toks)
                    if run_len >= K:
                        s_tok = min(s_tok, lo + run_start)
                        e_tok = max(e_tok, lo + run_start + run_len - 1)
                    start, end = toks[s_tok][1], toks[e_tok][2]
                    cand_obj = QuoteCandidate(
                        verse_id=int(self.doc_verse[d]), translation_id=self.translations[int(self.doc_trans[d])],
                        containment=float(containment[d]), matched=int(count[d]), verse_shingles=int(self.doc_count[d]),
                        longest_run=max(run_len, _longest_run(positions) if run_len < K else 0), start=start, end=end, evidence=text[start:end], kind="shingle",
                    )
                    results[cand_obj.verse_id] = cand_obj

        # short verses: exact normalised phrase
        for n in (2, 3, 4, 5):
            for i in range(len(words) - n + 1):
                key = tuple(words[i : i + n])
                for d in self.short.get(key, []):
                    v = int(self.doc_verse[d])
                    if v in results and results[v].containment >= 0.99:
                        continue
                    start, end = toks[i][1], toks[i + n - 1][2]
                    results[v] = QuoteCandidate(
                        verse_id=v, translation_id=self.translations[int(self.doc_trans[d])], containment=1.0, matched=n,
                        verse_shingles=max(1, int(self.doc_count[d])), longest_run=n, start=start, end=end,
                        evidence=text[start:end], kind="short_exact",
                    )
        ordered = sorted(results.values(), key=lambda c: (-c.containment, -c.matched))
        return _drop_subsumed(ordered)[:limit]

    def verse_text(self, verse_id: int, translation_id: str | None = None) -> str | None:
        for d in np.nonzero(self.doc_verse == verse_id)[0]:
            if translation_id is None or self.translations[int(self.doc_trans[d])] == translation_id:
                return self.doc_text[int(d)]
        return None


def _longest_common_run(a: list[str], b: list[str]) -> tuple[int, int]:
    """Longest contiguous common token run between a and b -> (length, start index in a)."""
    best_len, best_start = 0, 0
    prev = [0] * (len(b) + 1)
    for i in range(1, len(a) + 1):
        cur = [0] * (len(b) + 1)
        ai = a[i - 1]
        for j in range(1, len(b) + 1):
            if ai == b[j - 1]:
                cur[j] = prev[j - 1] + 1
                if cur[j] > best_len:
                    best_len, best_start = cur[j], i - cur[j]
        prev = cur
    return best_len, best_start


def _drop_subsumed(cands: list["QuoteCandidate"]) -> list["QuoteCandidate"]:
    """Drop a verse whose evidence lies inside a stronger overlapping match (e.g. JHN.3.15 within a quote of JHN.3.16)."""
    kept: list[QuoteCandidate] = []
    for c in sorted(cands, key=lambda x: (-x.longest_run, -x.matched)):
        if c.kind == "shingle" and any(
            k.start <= c.start and c.end <= k.end and k.longest_run > c.longest_run and k.containment >= 0.6 and k.verse_id != c.verse_id
            for k in kept
        ):
            continue
        kept.append(c)
    return sorted(kept, key=lambda x: (-x.containment, -x.matched))


def _longest_run(positions: list[int]) -> int:
    best = run = 1 if positions else 0
    for a, b in zip(positions, positions[1:]):
        run = run + 1 if b == a + 1 else (run if b == a else 1)
        best = max(best, run)
    return best + (K - 1 if positions else 0)


def _densest_cluster(positions: list[int], gap: int) -> list[int]:
    clusters: list[list[int]] = [[positions[0]]]
    for p in positions[1:]:
        if p - clusters[-1][-1] > gap:
            clusters.append([p])
        else:
            clusters[-1].append(p)
    return max(clusters, key=len)


_INDEX: QuoteIndex | None = None
_LOCK = threading.Lock()


def get_quote_index(session: Session) -> QuoteIndex:
    global _INDEX
    if _INDEX is None:
        with _LOCK:
            if _INDEX is None:
                rows = fetch_all(session, "SELECT verse_id, translation_id, text FROM bible_verse_texts ORDER BY verse_id, translation_id")
                if not rows:
                    raise RuntimeError("Bible corpus not loaded - run `python -m interactive_bible.cli load-bible`")
                _INDEX = QuoteIndex.build([(r["verse_id"], r["translation_id"], r["text"]) for r in rows])
    return _INDEX


def quote_confidence(containment: float, matched: int, longest_run: int, kind: str) -> float:
    """Deterministic prior for 'scripture_quote' before LLM verification."""
    if kind == "short_exact":
        return 0.9
    base = 0.55 + 0.45 * min(1.0, containment)
    if longest_run >= 8:
        base += 0.04
    if matched < 4:
        base -= 0.08
    return round(max(0.0, min(0.97, base)), 3)

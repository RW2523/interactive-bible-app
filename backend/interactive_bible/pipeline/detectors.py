"""Per-segment detectors (spec §4.1 detection order; stages C-F of §11.1)."""
from __future__ import annotations

import logging
import re
from typing import Any

from rapidfuzz import fuzz

from ..ai.llm import AIInvalidOutput, AIUnavailable, get_llm
from ..ai.schemas import QuoteVerifierOut, RefExtractorOut, SemanticMapperOut
from ..bible import books as B
from ..bible.refparser import parse_query_reference, parse_references
from ..config import get_settings
from ..db import fetch_all, session_scope
from ..retrieval.quotes import QuoteCandidate, QuoteIndex, quote_confidence
from ..retrieval.semantic import fts_verse_candidates, rrf, vector_verse_candidates, verse_embedding_count
from ..vocab.service import find_named_passages
from .types import Detection, SegmentWork

log = logging.getLogger(__name__)
REF_CUE = re.compile(
    r"\b(?:chapter|chapters|verse|verses)\s+(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty)\b|\b\d{1,3}:\d{1,3}\b",
    re.IGNORECASE,
)


def grounded_span(text: str, evidence: str, threshold: float = 85.0) -> tuple[int, int] | None:
    ev = (evidence or "").strip().strip('"').strip("“”").strip()
    if len(ev) < 4:
        return None
    idx = text.find(ev)
    if idx >= 0:
        return idx, idx + len(ev)
    low = text.lower()
    idx = low.find(ev.lower())
    if idx >= 0:
        return idx, idx + len(ev)
    if len(ev) > len(text) * 1.2:
        return None
    al = fuzz.partial_ratio_alignment(ev.lower(), low)
    if al is not None and al.score >= threshold:
        return al.dest_start, al.dest_end
    return None


def resolve_verse_id(value: str) -> tuple[int, int] | None:
    return parse_query_reference(value or "")


def verse_texts(ids: list[int], translation: str | None = None) -> dict[int, str]:
    if not ids:
        return {}
    translation = translation or get_settings().default_translation
    with session_scope() as s:
        rows = fetch_all(s, "SELECT verse_id, text FROM bible_verse_texts WHERE verse_id = ANY(:ids) AND translation_id = :t", ids=list(set(ids)), t=translation)
        found = {r["verse_id"]: r["text"] for r in rows}
        missing = [i for i in ids if i not in found]
        if missing:
            for r in fetch_all(s, "SELECT DISTINCT ON (verse_id) verse_id, text FROM bible_verse_texts WHERE verse_id = ANY(:ids) ORDER BY verse_id, translation_id", ids=missing):
                found[r["verse_id"]] = r["text"]
    return found


def passage_text(start: int, end: int, max_verses: int = 8) -> str:
    from ..bible.refparser import verse_ordinals

    ids = verse_ordinals(start, end)[:max_verses]
    texts = verse_texts(ids)
    body = " ".join(f"[{B.ref_from_ordinal(i)}] {texts.get(i, '')}" for i in ids)
    if len(verse_ordinals(start, end)) > max_verses:
        body += " ..."
    return body


# --------------------------------------------------------------------------- stage C
def detect_explicit(seg: SegmentWork, resource: dict[str, Any], run_id: str, ai: bool) -> list[Detection]:
    refs = parse_references(seg.text, context_before=seg.preceding_text[-1500:])
    pairs = []
    for r in refs:
        det = Detection(
            start=r.start_ordinal, end=r.end_ordinal, type="direct_reference", subtype=r.kind, confidence=r.confidence,
            evidence_text=seg.sentence_for_span(r.start, r.end), spans=[(r.start, r.end)], detectors=["refparser"],
            signals={"parser": {"flags": r.flags, "form": r.form, "raw": r.raw_text, "confidence": r.confidence}},
        )
        pairs.append((r, det))
    needs = [(r, d) for r, d in pairs if r.needs_verification]
    covered = [(r.start, r.end) for r, _ in pairs]
    cue = any(not any(s <= m.start() < e for s, e in covered) for m in REF_CUE.finditer(seg.text))
    if not ai:
        for _, d in needs:
            d.review_reasons.append("unverified_reference_form")
        return [d for _, d in pairs]
    if not needs and not cue:
        return [d for _, d in pairs]

    llm = get_llm()
    aliases = sorted({b.name for b in B.BOOKS})
    try:
        result = llm.run(
            "P-02",
            {
                "segment_text": seg.text, "context_before": seg.preceding_text[-800:],
                "parser_candidates": [{"canonical": d.canonical, "raw_text": r.raw_text, "flags": r.flags} for r, d in pairs],
                "book_aliases": aliases,
            },
            RefExtractorOut, resource_id=resource["id"], run_id=run_id,
        )
    except (AIUnavailable, AIInvalidOutput) as exc:
        seg.notes.append(f"P-02 unavailable: {exc}")
        for _, d in needs:
            d.review_reasons.append("verification_unavailable")
        return [d for _, d in pairs]
    seg.ai_calls.append(result.provenance())
    llm_refs: list[tuple[tuple[int, int], Any]] = []
    for ref in result.output.references:
        start = resolve_verse_id(ref.canonical_start)
        end = resolve_verse_id(ref.canonical_end or ref.canonical_start)
        if not start or not end:
            continue
        rng = (start[0], max(start[1], end[1]))
        if rng[1] < rng[0] or B.from_ordinal(rng[0])[0] != B.from_ordinal(rng[1])[0]:
            continue
        llm_refs.append((rng, ref))
    matched_llm: set[int] = set()
    for r, d in pairs:
        exact = next((i for i, (rng, _) in enumerate(llm_refs) if rng == (d.start, d.end)), None)
        overlap = next((i for i, (rng, _) in enumerate(llm_refs) if rng[0] <= d.end and rng[1] >= d.start), None)
        if exact is not None:
            matched_llm.add(exact)
            if r.needs_verification:
                d.confidence = max(d.confidence, 0.95)
                d.detectors.append("P-02")
                d.signals["p02"] = "confirmed"
        elif overlap is not None and r.needs_verification and any(f in r.flags for f in ("asr_split", "fuzzy_book", "asr_alias", "context_book", "context_chapter", "context_relative")):
            matched_llm.add(overlap)
            rng, ref = llm_refs[overlap]
            d.start, d.end = rng
            d.confidence = 0.9
            d.detectors.append("P-02")
            d.signals["p02"] = "corrected"
            d.review_reasons.append("llm_corrected_reference")
        elif overlap is not None:
            matched_llm.add(overlap)
            if r.needs_verification:
                d.detectors.append("P-02")
                d.signals["p02"] = "partially_confirmed"
        elif r.needs_verification:
            d.signals["p02"] = "not_confirmed"
            strong_doubt = any(f in r.flags for f in ("asr_split", "fuzzy_book", "ambiguous_book", "context_book", "context_chapter", "context_relative", "asr_alias"))
            d.confidence = min(d.confidence, 0.6 if strong_doubt else 0.78)
            d.review_reasons.append("llm_did_not_confirm_reference")
    extra: list[Detection] = []
    for i, (rng, ref) in enumerate(llm_refs):
        if i in matched_llm:
            continue
        span = grounded_span(seg.text, ref.raw_text, 88) or grounded_span(seg.text, ref.evidence_quote, 88)
        if not span:
            continue
        extra.append(Detection(
            start=rng[0], end=rng[1], type="direct_reference", subtype="llm_extracted", confidence=min(0.88, ref.confidence),
            evidence_text=seg.sentence_for_span(*span), spans=[span], detectors=["P-02"], signals={"p02": "added", "raw": ref.raw_text},
            review_reasons=["llm_only_reference"],
        ))
    return [d for _, d in pairs] + extra


# --------------------------------------------------------------------------- stage D
def detect_quotes(seg: SegmentWork, qindex: QuoteIndex, resource: dict[str, Any], run_id: str, ai: bool) -> tuple[list[Detection], list[int], list[QuoteCandidate]]:
    candidates = qindex.search(seg.text, min_containment=0.15 if ai else 0.2, min_matched=2, limit=14)
    raw_candidates = list(candidates)
    if not ai:
        # without LLM verification only strong lexical evidence counts: most of the verse, or a long exact run
        candidates = [c for c in candidates if c.kind == "short_exact" or c.containment >= 0.45 or (c.longest_run >= 8 and c.matched >= 3)]
    if not candidates:
        return [], [], raw_candidates
    dets: list[Detection] = []
    theme_only: list[int] = []
    if not ai:
        for c in candidates:
            if c.kind == "short_exact":
                conf, reasons = 0.88, ["unverified_short_quote"]
            elif c.containment >= 0.85 and c.matched >= 5:
                conf, reasons = min(0.96, quote_confidence(c.containment, c.matched, c.longest_run, c.kind)), []
            elif c.longest_run >= 8 and c.matched >= 3:
                conf, reasons = 0.9, ["partial_verse_quote"]
            elif c.containment >= 0.6 or c.longest_run >= 6:
                conf, reasons = 0.84, ["unverified_partial_quote"]
            else:
                conf, reasons = 0.72, ["weak_lexical_overlap"]
            dets.append(Detection(
                start=c.verse_id, end=c.verse_id, type="scripture_quote", subtype="lexical_match", confidence=conf,
                evidence_text=c.evidence, spans=[(c.start, c.end)], detectors=["quote_index"],
                signals={"containment": round(c.containment, 3), "matched": c.matched, "translation": c.translation_id, "longest_run": c.longest_run},
                review_reasons=reasons,
            ))
        return dets, theme_only, raw_candidates

    top = candidates[:8]
    ids = [c.verse_id for c in top]
    web = verse_texts(ids)
    payload = []
    for c in top:
        matched_text = qindex.verse_text(c.verse_id, c.translation_id) or ""
        entry = {"verse": B.ref_from_ordinal(c.verse_id), "translation": c.translation_id.upper(), "text": matched_text, "lexical_overlap": round(c.containment, 2)}
        if c.translation_id != "web" and web.get(c.verse_id):
            entry["web_text"] = web[c.verse_id]
        payload.append(entry)
    try:
        result = get_llm().run("P-03", {"segment_text": seg.text, "verse_candidates_with_text": payload}, QuoteVerifierOut, resource_id=resource["id"], run_id=run_id)
    except (AIUnavailable, AIInvalidOutput) as exc:
        seg.notes.append(f"P-03 unavailable: {exc}")
        # fall back to deterministic handling for the strongest lexical matches
        return detect_quotes(seg, qindex, resource, run_id, ai=False)[0], [], raw_candidates
    seg.ai_calls.append(result.provenance())
    by_id = {c.verse_id: c for c in top}
    for m in result.output.matches:
        rng = resolve_verse_id(m.verse)
        if not rng or rng[0] not in by_id:
            continue
        c = by_id[rng[0]]
        if m.classification == "theme_only":
            theme_only.append(c.verse_id)
            continue
        if m.classification == "unrelated":
            continue
        base = {
            "exact_quote": 0.96 if c.containment >= 0.5 else 0.92,
            "close_quote": 0.92 if c.containment >= 0.3 else 0.89,
            "paraphrase": 0.87 if c.containment >= 0.25 else 0.84,
        }[m.classification]
        reasons: list[str] = []
        conf = base if m.confidence >= 0.7 else min(base, 0.8)
        span = grounded_span(seg.text, m.evidence)
        if span is None:
            if c.containment >= 0.3:
                span = (c.start, c.end)
            else:
                span = (c.start, c.end)
                conf = min(conf, 0.75)
                reasons.append("quote_evidence_not_grounded")
        dets.append(Detection(
            start=c.verse_id, end=c.verse_id, type="scripture_quote", subtype=m.classification, confidence=conf,
            evidence_text=seg.text[span[0] : span[1]], spans=[span], detectors=["quote_index", "P-03"],
            signals={"containment": round(c.containment, 3), "matched": c.matched, "translation": c.translation_id, "p03_confidence": m.confidence},
            review_reasons=reasons,
        ))
    return dets, theme_only, raw_candidates


# --------------------------------------------------------------------------- contextual
def detect_contextual(seg: SegmentWork, previous_direct: list[Detection], quote_candidates: list[QuoteCandidate], already: set[tuple[int, int]]) -> list[Detection]:
    dets: list[Detection] = []
    for hit in find_named_passages(seg.text):
        for start, end in hit["passages"][:2]:
            dets.append(Detection(
                start=start, end=end, type="contextual_reference", subtype="named_passage", confidence=hit["confidence"],
                evidence_text=seg.sentence_for_span(hit["start"], hit["end"]), spans=[(hit["start"], hit["end"])],
                detectors=["named_passage_vocab"], signals={"entity_id": hit["entity_id"], "alias": hit["alias"]},
                review_reasons=[] if hit["confidence"] >= 0.85 else ["generic_passage_alias"],
            ))
    passage_refs = [d for d in previous_direct if d.end - d.start >= 1 and d.type == "direct_reference"]
    for d in passage_refs:
        for c in quote_candidates:
            if d.start <= c.verse_id <= d.end and c.containment >= 0.2 and not any(s <= c.verse_id <= e for s, e in already):
                dets.append(Detection(
                    start=c.verse_id, end=c.verse_id, type="contextual_reference", subtype="inherited_passage_context",
                    confidence=0.82, evidence_text=c.evidence, spans=[(c.start, c.end)], detectors=["passage_context_inheritance"],
                    signals={"context_ref": d.canonical, "containment": round(c.containment, 3)}, review_reasons=["inherited_context"],
                ))
    return dets


# --------------------------------------------------------------------------- stages E + F
def detect_semantic(seg: SegmentWork, resource: dict[str, Any], run_id: str, mapped: list[Detection], theme_only: list[int], hint_ids: list[int]) -> list[Detection]:
    llm = get_llm()
    settings = get_settings()
    query_vec = seg.embeddings.get("query")
    with session_scope() as s:
        vector_hits = vector_verse_candidates(s, query_vec[1], 40) if query_vec and verse_embedding_count(s) > 0 else []
        fts_hits = fts_verse_candidates(s, seg.text, 40)
    fused = rrf([[v for v, _ in vector_hits], [v for v, _ in fts_hits], theme_only, hint_ids], weights=[1.0, 0.6, 1.3, 0.8])
    sims = dict(vector_hits)

    def excluded(vid: int) -> bool:
        for d in mapped:
            if d.start <= vid <= d.end:
                return True
            if d.type == "direct_reference":
                code, ch, v = B.from_ordinal(vid)
                dcode, dch, dv = B.from_ordinal(d.start)
                if code == dcode and ch == dch and abs(v - dv) <= 2:
                    return True
        return False

    candidates = [vid for vid, _ in fused if not excluded(vid)][: settings.semantic_candidates]
    if not candidates:
        return []
    texts = verse_texts(candidates)
    payload = [{"verse": B.ref_from_ordinal(v), "text": texts.get(v, "")} for v in candidates]
    try:
        result = llm.run(
            "P-04",
            {
                "segment_text": seg.text, "context_before": seg.context_before, "context_after": seg.context_after,
                "already_mapped": [d.canonical for d in mapped], "candidate_verses": payload, "max_accepted": settings.semantic_max_accepted,
            },
            SemanticMapperOut, resource_id=resource["id"], run_id=run_id,
        )
    except (AIUnavailable, AIInvalidOutput) as exc:
        seg.notes.append(f"P-04 unavailable: {exc}")
        return []
    seg.ai_calls.append(result.provenance())
    allowed = set(candidates)
    dets: list[Detection] = []
    for acc in result.output.accepted[: settings.semantic_max_accepted]:
        rng = resolve_verse_id(acc.verse)
        if not rng or rng[0] not in allowed:
            continue
        reasons: list[str] = []
        conf = min(acc.confidence, 0.93)
        span = grounded_span(seg.text, acc.evidence, 80)
        if span is None:
            conf = min(conf, 0.75)
            reasons.append("semantic_evidence_not_grounded")
            span = (0, min(len(seg.text), 200))
        if rng[0] not in sims and rng[0] not in theme_only:
            conf = min(conf, 0.88)
        dets.append(Detection(
            start=rng[0], end=rng[0], type="ai_related", subtype=acc.relationship, confidence=round(conf, 3),
            evidence_text=seg.text[span[0] : span[1]], spans=[span], detectors=["hybrid_retrieval", "P-04"], why_related=acc.why_related.strip(),
            signals={"vector_similarity": round(sims.get(rng[0], 0.0), 4), "fts_rank": next((i for i, (v, _) in enumerate(fts_hits) if v == rng[0]), None), "p04_confidence": acc.confidence},
            review_reasons=reasons,
        ))
    return dets

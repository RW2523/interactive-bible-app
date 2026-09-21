"""Stage G: deterministic merge, deduplication, range collapsing and P-05 primary-verse selection."""
from __future__ import annotations

import logging
from collections import defaultdict
from typing import Any

from ..ai.llm import AIInvalidOutput, AIUnavailable, get_llm
from ..ai.schemas import ClassifierOut
from ..bible import books as B
from .detectors import resolve_verse_id
from .types import TYPE_PRIORITY, Detection, Mapping, SegmentWork

log = logging.getLogger(__name__)
ABSORB_MAX_VERSES = 10  # keep in sync with persist.CHILD_EXPANSION_MAX


def _span_size(start: int, end: int) -> int:
    from ..bible.refparser import verse_ordinals

    if B.from_ordinal(start)[0] != B.from_ordinal(end)[0]:
        return 10_000
    return len(verse_ordinals(start, end))


def _next_verse(ordinal: int) -> int | None:
    code, ch, v = B.from_ordinal(ordinal)
    if v < B.verse_count(code, ch):
        return B.ordinal(code, ch, v + 1)
    if ch < B.chapter_count(code):
        return B.ordinal(code, ch + 1, 1)
    return None


def _is_deterministic_written(m: Detection) -> bool:
    parser = m.signals.get("parser") or {}
    return m.type == "direct_reference" and "refparser" in m.detectors and parser.get("form") == "written" and parser.get("confidence", 0) >= 0.97


def collapse_quote_runs(dets: list[Detection]) -> list[Detection]:
    quotes = sorted([d for d in dets if d.type == "scripture_quote" and not d.is_range], key=lambda d: d.start)
    others = [d for d in dets if not (d.type == "scripture_quote" and not d.is_range)]
    out: list[Detection] = []
    for d in quotes:
        if out and _next_verse(out[-1].end) == d.start:
            prev = out[-1]
            gap = min(abs(s2 - e1) for (_, e1) in prev.spans for (s2, _) in d.spans)
            if gap <= 60:
                prev.end = d.end
                prev.confidence = min(prev.confidence, d.confidence)
                prev.spans = sorted(set(prev.spans + d.spans))
                prev.detectors = sorted(set(prev.detectors + d.detectors))
                prev.subtype = prev.subtype if TYPE_PRIORITY.get(prev.type) else d.subtype
                prev.evidence_text = prev.evidence_text if len(prev.evidence_text) >= len(d.evidence_text) else d.evidence_text
                prev.review_reasons = sorted(set(prev.review_reasons + d.review_reasons))
                prev.signals.setdefault("collapsed_verses", []).append(B.ref_from_ordinal(d.start))
                continue
        out.append(d)
    return others + out


def _count_mentions(spans: list[tuple[int, int]]) -> int:
    merged: list[tuple[int, int]] = []
    for s, e in sorted(spans):
        if merged and s <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], e))
        else:
            merged.append((s, e))
    return max(1, len(merged))


def merge_detections(seg: SegmentWork, detections: list[Detection]) -> list[Mapping]:
    dets = collapse_quote_runs(detections)
    groups: dict[tuple[int, int], list[Detection]] = defaultdict(list)
    for d in dets:
        groups[d.key].append(d)
    mappings: list[Mapping] = []
    for key, ds in groups.items():
        best = max(ds, key=lambda d: (TYPE_PRIORITY[d.type], d.confidence))
        same = [d for d in ds if d.type == best.type]
        conf = max(d.confidence for d in same)
        reasons = {r for d in same for r in d.review_reasons}
        if len({d.type for d in ds}) > 1:
            conf = min(0.99, conf + 0.02)
        # an explicit reference corroborated by a verified quotation of the same verse is verified evidence
        corroborating_quote = max((d.confidence for d in ds if d.type == "scripture_quote" and d.confidence >= 0.9 and not d.review_reasons), default=None)
        if best.type == "direct_reference" and corroborating_quote is not None:
            conf = max(conf, min(0.97, corroborating_quote))
            reasons -= {"unverified_reference_form", "verification_unavailable"}
        spans = sorted({sp for d in ds for sp in d.spans})
        m = Mapping(
            start=key[0], end=key[1], type=best.type, subtype=best.subtype, confidence=round(conf, 3),
            evidence_text=best.evidence_text, spans=spans, detectors=sorted({x for d in ds for x in d.detectors}),
            why_related=next((d.why_related for d in ds if d.why_related), None),
            signals={d.type: d.signals for d in ds}, review_reasons=sorted(reasons),
            mention_count=_count_mentions(spans),
        )
        if best.type == "direct_reference" and "parser" in best.signals:
            m.signals["parser"] = best.signals["parser"]
        mappings.append(m)

    # absorb single-verse mappings covered by a range mapping
    ranges = [m for m in mappings if m.is_range]
    keep: list[Mapping] = []
    for m in mappings:
        if m.is_range:
            keep.append(m)
            continue
        # only small passages absorb single verses: they get per-verse child links when persisted (<=10 verses);
        # a whole-chapter mention must not swallow an explicit single-verse reference
        container = next((r for r in ranges if r.start <= m.start <= r.end and _span_size(r.start, r.end) <= ABSORB_MAX_VERSES), None)
        if container is None:
            keep.append(m)
            continue
        if container.type == m.type:
            container.spans = sorted(set(container.spans + m.spans))
            container.mention_count = _count_mentions(container.spans)
            container.detectors = sorted(set(container.detectors + m.detectors))
            container.confidence = max(container.confidence, m.confidence) if m.type != "ai_related" else container.confidence
        elif TYPE_PRIORITY[container.type] > TYPE_PRIORITY[m.type]:
            continue  # the explicit passage mapping already covers this weaker single-verse mapping
        else:
            keep.append(m)
    for m in keep:
        m.evidence_times = [seg.unit_times_for_span(s, e) for s, e in m.spans]
    return keep


AI_RELATED_DISPLAY_MIN = 0.90  # §4.2: 0.80-0.89 "may show"; live Gemini self-scores weak thematic matches at 0.80-0.85
AI_RELATED_INDEX_CAP = 0.78  # kept for search/review (index_only, or pending_review on reviewed content)
ANCHOR_TYPES = ("direct_reference", "scripture_quote", "contextual_reference")


def _overlaps(a: tuple[int, int], b: tuple[int, int]) -> bool:
    return a[0] < b[1] and b[0] < a[1]


def _adjacent_verses(a: Mapping, b: Mapping) -> bool:
    ca, cha, va = B.from_ordinal(a.start)
    cb, chb, vb = B.from_ordinal(b.start)
    return ca == cb and cha == chb and abs(va - vb) <= 1


def apply_semantic_precision_policy(seg: SegmentWork) -> None:
    """Precision first (§16.1): an AI Related mapping is shown only when it is the strongest match for its own idea.

    * evidence inside a sentence that cites, quotes or names a passage makes the verse a cross-reference of that
      passage (Verse Intelligence already offers cross references), not a separate claim of the resource
    * of several AI matches for the same words only the strongest is shown (adjacent verses count as one passage)
    * AI matches below 0.90 are kept for search and review instead of being shown
    Demoted mappings keep their evidence and the model's own score in signals; the demotion reason is recorded.
    """
    from ..bible.text import sentence_split

    sentences = sentence_split(seg.text) or [(0, len(seg.text))]
    anchors = [sent for m in seg.mappings if m.type in ANCHOR_TYPES for sp in m.spans for sent in sentences if _overlaps(sp, sent) or sp[0] == sent[0]]
    shown: list[Mapping] = []
    for m in sorted((m for m in seg.mappings if m.type == "ai_related"), key=lambda m: -m.confidence):
        reason = None
        if any(_overlaps(sp, a) for sp in m.spans for a in anchors):
            reason = "related_to_cited_passage"
        elif any(_overlaps(sp, osp) and not _adjacent_verses(m, o) for o in shown for sp in m.spans for osp in o.spans):
            reason = "weaker_match_for_same_evidence"
        elif m.confidence < AI_RELATED_DISPLAY_MIN:
            reason = "ai_match_below_display_bar"
        if reason is None:
            shown.append(m)
            continue
        m.signals = {**m.signals, "ai_related": {**(m.signals.get("ai_related") or {}), "pre_policy_confidence": m.confidence}}
        m.confidence = min(m.confidence, AI_RELATED_INDEX_CAP)
        m.review_reasons = sorted(set(m.review_reasons + [reason]))


def _resolve_mapping(mappings: list[Mapping], verse: str | None) -> Mapping | None:
    if not verse:
        return None
    rng = resolve_verse_id(verse)
    if not rng:
        return None
    exact = next((m for m in mappings if (m.start, m.end) == rng), None)
    if exact:
        return exact
    return next((m for m in mappings if m.start <= rng[0] <= m.end), None)


def deterministic_primary(seg: SegmentWork, mappings: list[Mapping], media: bool) -> Mapping | None:
    if not mappings:
        return None
    ranked = sorted(mappings, key=lambda m: (TYPE_PRIORITY[m.type], m.mention_count, m.confidence, -min(s for s, _ in m.spans)), reverse=True)
    top = ranked[0]
    if media:
        return top
    explicit = [m for m in mappings if m.type in ("direct_reference", "scripture_quote")]
    if len(explicit) == 1 and top in explicit:
        return top
    if len(ranked) > 1 and top.mention_count >= ranked[1].mention_count + 2:
        return top
    if len(ranked) == 1 and top.confidence >= 0.85:
        return top
    return None


def classify_and_select_primary(seg: SegmentWork, mappings: list[Mapping], resource: dict[str, Any], run_id: str, ai: bool, media: bool) -> None:
    if not mappings:
        return
    primary: Mapping | None = None
    if ai:
        def rows(t: str) -> list[dict[str, Any]]:
            return [{"verse": m.canonical, "confidence": m.confidence, "evidence": m.evidence_text[:300], "subtype": m.subtype} for m in mappings if m.type == t]
        try:
            result = get_llm().run(
                "P-05",
                {
                    "segment_text": seg.text, "direct_refs": rows("direct_reference"), "quote_matches": rows("scripture_quote"),
                    "contextual_refs": rows("contextual_reference"), "semantic_matches": rows("ai_related"),
                },
                ClassifierOut, resource_id=resource["id"], run_id=run_id,
            )
        except (AIUnavailable, AIInvalidOutput) as exc:
            seg.notes.append(f"P-05 unavailable: {exc}")
            result = None
        if result is not None:
            seg.ai_calls.append(result.provenance())
            seen: set[int] = set()
            for rel in result.output.relationships:
                m = _resolve_mapping(mappings, rel.verse)
                if m is None:
                    continue
                seen.add(id(m))
                deterministic = _is_deterministic_written(m)
                if TYPE_PRIORITY[rel.type] > TYPE_PRIORITY[m.type]:
                    seg.notes.append(f"P-05 upgrade ignored for {m.canonical}")
                elif TYPE_PRIORITY[rel.type] < TYPE_PRIORITY[m.type] and not deterministic:
                    m.signals["p05_downgraded_from"] = m.type
                    m.type = rel.type
                    m.review_reasons = sorted(set(m.review_reasons + ["p05_downgraded"]))
                floor = 0.95 if deterministic else max(0.0, m.confidence - 0.2)
                m.confidence = round(min(m.confidence, max(rel.confidence, floor)), 3)
            for m in mappings:
                if id(m) not in seen and not _is_deterministic_written(m):
                    m.confidence = min(m.confidence, 0.78)
                    m.review_reasons = sorted(set(m.review_reasons + ["p05_omitted"]))
            primary = _resolve_mapping(mappings, result.output.primary_verse)
    if primary is None:
        primary = deterministic_primary(seg, mappings, media)
    for m in mappings:
        m.primary = m is primary

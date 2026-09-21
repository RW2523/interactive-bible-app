"""Semantic segmentation (ING-05, spec §3.3) - deterministic rules with optional P-01 refinement."""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field

from ..ai.llm import AIInvalidOutput, AIUnavailable, get_llm
from ..ai.schemas import SegmenterOut
from .units import Unit

log = logging.getLogger(__name__)

SPOKEN_MIN_MS, SPOKEN_TARGET_MIN_MS, SPOKEN_TARGET_MAX_MS, SPOKEN_MAX_MS = 15_000, 30_000, 120_000, 180_000
TRANSITIONS = re.compile(
    r"^(?:now|so|second(?:ly)?|third(?:ly)?|finally|first(?:ly)?|next|in closing|let me|let's|let us|here's|the (?:second|third|next|last|final)|"
    r"but here's|friends|church|brothers and sisters|another|lastly|to close|in conclusion|turn with me|our next|one more)\b",
    re.IGNORECASE,
)
DOC_MAX_WORDS = 350
DOC_MAX_PARAGRAPHS = 4


@dataclass
class SegmentPlan:
    unit_indices: list[int]
    topic_hint: str | None = None
    boundary_reason: str = ""
    source: str = "rules"
    notes: list[str] = field(default_factory=list)


def _duration(units: list[Unit], idx: list[int]) -> int:
    a, b = units[idx[0]], units[idx[-1]]
    if a.start_ms is None or b.end_ms is None:
        return 0
    return max(0, b.end_ms - a.start_ms)


def _mostly_non_speech(units: list[Unit], idx: list[int]) -> bool:
    """True when most of these units are music/singing (captions marked them), so they are not preaching."""
    chars = sum(len(units[i].text or units[i].text_raw) for i in idx) or 1
    sung = sum(len(units[i].text or units[i].text_raw) for i in idx if units[i].meta.get("non_speech"))
    return sung / chars >= 0.6


def rule_segments_spoken(units: list[Unit], scripture: set[int]) -> list[SegmentPlan]:
    plans: list[SegmentPlan] = []
    current: list[int] = []
    for i, u in enumerate(units):
        if current:
            dur_with = (u.end_ms or 0) - (units[current[0]].start_ms or 0)
            dur_now = _duration(units, current)
            prev = units[current[-1]]
            gap = (u.start_ms or 0) - (prev.end_ms or 0)
            speaker_change = (u.speaker or "") != (prev.speaker or "")
            just_after_scripture = current[-1] in scripture and not (len(current) >= 2 and current[-2] in scripture and False)
            cue = TRANSITIONS.match(u.text or u.text_raw) is not None
            music_boundary = bool(u.meta.get("non_speech")) != bool(prev.meta.get("non_speech"))
            reason = ""
            if dur_with > SPOKEN_MAX_MS:
                reason = "max_duration"
            elif music_boundary:  # a song starting or ending: keep worship and teaching in separate segments
                reason = "music_boundary"
            elif dur_now >= SPOKEN_TARGET_MIN_MS and not just_after_scripture:
                if speaker_change:
                    reason = "speaker_change"
                elif cue:
                    reason = "transition_phrase"
                elif gap >= 1200:
                    reason = "pause"
                elif dur_now >= 90_000 and dur_with > SPOKEN_TARGET_MAX_MS:
                    reason = "target_duration"
            if reason:
                plans.append(SegmentPlan(current, boundary_reason=reason))
                current = []
        current.append(i)
    if current:
        plans.append(SegmentPlan(current, boundary_reason="end_of_resource"))
    # merge a too-short tail/head into its neighbour when that keeps it under the maximum
    merged: list[SegmentPlan] = []
    for plan in plans:
        if (merged and _duration(units, plan.unit_indices) < SPOKEN_MIN_MS and _duration(units, merged[-1].unit_indices + plan.unit_indices) <= SPOKEN_MAX_MS
                and _mostly_non_speech(units, plan.unit_indices) == _mostly_non_speech(units, merged[-1].unit_indices)):
            merged[-1].unit_indices.extend(plan.unit_indices)
            merged[-1].notes.append("merged_short_segment")
        else:
            merged.append(plan)
    return merged


def rule_segments_document(units: list[Unit]) -> list[SegmentPlan]:
    plans: list[SegmentPlan] = []
    current: list[int] = []
    words = 0
    paragraphs = 0
    for i, u in enumerate(units):
        n_words = len(u.text.split())
        start_new = False
        reason = ""
        if current:
            if u.kind == "heading":
                start_new, reason = True, "heading"
            elif paragraphs >= DOC_MAX_PARAGRAPHS and u.kind != "list_item":
                start_new, reason = True, "paragraph_limit"
            elif words + n_words > DOC_MAX_WORDS and paragraphs >= 1:
                start_new, reason = True, "word_limit"
        if start_new:
            plans.append(SegmentPlan(current, boundary_reason=reason))
            current, words, paragraphs = [], 0, 0
        current.append(i)
        words += n_words
        if u.kind in ("paragraph", "quote", "table"):
            paragraphs += 1
        elif u.kind == "list_item":
            paragraphs += 0.34  # type: ignore[assignment]
    if current:
        plans.append(SegmentPlan(current, boundary_reason="end_of_resource"))
    # a heading-only segment should not stand alone
    out: list[SegmentPlan] = []
    for p in plans:
        if out and all(units[i].kind == "heading" for i in out[-1].unit_indices):
            out[-1].unit_indices.extend(p.unit_indices)
            out[-1].boundary_reason = p.boundary_reason
        else:
            out.append(p)
    return out


def validate_plan(plans: list[SegmentPlan], n_units: int) -> list[str]:
    problems = []
    flat = [i for p in plans for i in p.unit_indices]
    if flat != list(range(n_units)):
        problems.append("units not covered exactly once in order")
    if any(not p.unit_indices for p in plans):
        problems.append("empty segment")
    return problems


def ai_segments_spoken(units: list[Unit], scripture: set[int], resource_type: str, language: str, resource_id: str, run_id: str) -> list[SegmentPlan] | None:
    llm = get_llm()
    if not llm.available or len(units) < 4:
        return None
    id_to_index = {u.id: i for i, u in enumerate(units)}
    plans: list[SegmentPlan] = []
    start = 0
    window = 110
    guard = 0
    while start < len(units) and guard < 200:
        guard += 1
        chunk = units[start : start + window]
        payload = "\n".join(
            f"{u.id} | {(u.start_ms or 0) / 1000:.1f} | {(u.end_ms or 0) / 1000:.1f} | {u.speaker or '-'} | {str(start + k in scripture).lower()} | {u.text}"
            for k, u in enumerate(chunk)
        )
        try:
            result = llm.run("P-01", {"resource_type": resource_type, "language": language, "timestamped_units": payload}, SegmenterOut, resource_id=resource_id, run_id=run_id)
        except (AIUnavailable, AIInvalidOutput) as exc:
            log.warning("P-01 failed, falling back to rules: %s", exc)
            return None
        segs = result.output.segments
        indices_list: list[list[int]] = []
        for seg in segs:
            idx = [id_to_index[x] for x in seg.unit_ids if x in id_to_index]
            if idx:
                indices_list.append(sorted(set(idx)))
        expected = list(range(start, start + len(chunk)))
        if [i for idx in indices_list for i in idx] != expected:
            log.warning("P-01 returned a non-contiguous plan; using rules")
            return None
        last_window = start + len(chunk) >= len(units)
        keep = indices_list if last_window or len(indices_list) == 1 else indices_list[:-1]
        for idx, seg in zip(keep, segs):
            plans.append(SegmentPlan(idx, topic_hint=seg.topic_hint, boundary_reason=seg.boundary_reason or "semantic", source="P-01"))
        start = keep[-1][-1] + 1
    if validate_plan(plans, len(units)):
        return None
    # enforce duration bounds deterministically
    fixed: list[SegmentPlan] = []
    for plan in plans:
        dur = _duration(units, plan.unit_indices)
        if dur > SPOKEN_MAX_MS:
            sub = rule_segments_spoken([units[i] for i in plan.unit_indices], {k for k, i in enumerate(plan.unit_indices) if i in scripture})
            for s in sub:
                fixed.append(SegmentPlan([plan.unit_indices[k] for k in s.unit_indices], plan.topic_hint, "split_over_max", "P-01+rules"))
        elif fixed and dur < SPOKEN_MIN_MS and _duration(units, fixed[-1].unit_indices + plan.unit_indices) <= SPOKEN_MAX_MS:
            fixed[-1].unit_indices.extend(plan.unit_indices)
            fixed[-1].notes.append("merged_short_segment")
        else:
            fixed.append(plan)
    return fixed

"""Confidence rules (spec §4.2) and review routing (ING-15, REV-06, REV-07)."""
from __future__ import annotations

from typing import Any

from ..config import get_settings

USER_VISIBLE = ("published", "approved")
SEARCHABLE = ("published", "approved", "index_only")


def confidence_band(conf: float) -> str:
    if conf >= 0.95:
        return "very_high"
    if conf >= 0.90:
        return "high"
    if conf >= 0.80:
        return "medium"
    if conf >= 0.65:
        return "weak"
    return "low"


def requires_editorial_review(resource: dict[str, Any]) -> bool:
    return bool(resource.get("requires_review")) or (bool(resource.get("is_official")) and get_settings().official_requires_review)


def route(confidence: float, needs_review: bool, reasons: list[str], resource: dict[str, Any]) -> tuple[str, bool, list[str]]:
    """Return (review_status, needs_review, reasons)."""
    reasons = list(reasons)
    if confidence < 0.65:
        return "discarded", False, reasons + ["below_0.65"]
    if confidence < 0.80:
        if requires_editorial_review(resource):
            return "pending_review", True, reasons + ["weak_candidate", "editorial_review_required"]
        return "index_only", True, reasons + ["weak_candidate"]
    if requires_editorial_review(resource):
        return "pending_review", True, reasons + ["editorial_review_required"]
    if confidence >= 0.90:
        return "published", bool(needs_review), reasons
    return "published", True, reasons + ["uncertain_confidence_band"]


def display_label(relationship_type: str, confidence: float, is_human_verified: bool) -> dict[str, Any]:
    """User-facing label (spec §2.4). Unverified 0.80-0.89 explicit mappings are shown as AI Related."""
    from .types import TYPE_LABEL

    label = TYPE_LABEL.get(relationship_type, relationship_type)
    shown_type = relationship_type
    note = None
    if not is_human_verified and confidence < 0.90 and relationship_type in ("direct_reference", "scripture_quote", "contextual_reference"):
        note = f"Possible {label.lower()} (not yet verified)"
        shown_type, label = "ai_related", "AI Related"
    trust = {"direct_reference": "Very high", "scripture_quote": "High", "contextual_reference": "High/medium", "ai_related": "Medium/high"}[shown_type]
    if is_human_verified:
        trust = "Highest provenance"
    conf_label = "High confidence" if confidence >= 0.9 else ("Medium confidence" if confidence >= 0.8 else "Low confidence")
    return {"type": shown_type, "label": label, "human_verified": is_human_verified, "trust": trust, "confidence_label": conf_label, "note": note, "detected_type": relationship_type}

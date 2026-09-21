"""Confidence routing (spec §4.2, ING-15/REV-06/REV-07) and user-facing relationship labels (spec §2.4)."""
from __future__ import annotations

import pytest

from interactive_bible.pipeline.routing import confidence_band, display_label, requires_editorial_review, route

pytestmark = pytest.mark.nodb

COMMUNITY = {"is_official": False, "requires_review": False}
OFFICIAL = {"is_official": True, "requires_review": False}
REVIEW_FLAGGED = {"is_official": False, "requires_review": True}


@pytest.mark.parametrize("conf,status,needs_review,extra_reason", [
    (0.99, "published", False, None),
    (0.95, "published", False, None),
    (0.92, "published", False, None),
    (0.90, "published", False, None),
    (0.89, "published", True, "uncertain_confidence_band"),
    (0.80, "published", True, "uncertain_confidence_band"),
    (0.79, "index_only", True, "weak_candidate"),
    (0.65, "index_only", True, "weak_candidate"),
    (0.649, "discarded", False, "below_0.65"),
    (0.10, "discarded", False, "below_0.65"),
])
def test_routing_bands_for_non_official_resources(conf, status, needs_review, extra_reason):
    """ING-15: >=0.90 publish; 0.80-0.89 published but queued for review; 0.65-0.79 index only; <0.65 discarded."""
    got_status, got_review, reasons = route(conf, False, [], COMMUNITY)
    assert (got_status, got_review) == (status, needs_review)
    if extra_reason:
        assert extra_reason in reasons


@pytest.mark.parametrize("resource", [OFFICIAL, REVIEW_FLAGGED])
@pytest.mark.parametrize("conf,status", [(0.99, "pending_review"), (0.85, "pending_review"), (0.70, "pending_review"), (0.5, "discarded")])
def test_official_or_review_flagged_resources_require_editorial_review(resource, conf, status):
    """REV-06: official resources (and resources flagged requires_review) never auto-publish."""
    got_status, got_review, reasons = route(conf, False, [], resource)
    assert got_status == status
    if status == "pending_review":
        assert got_review is True and "editorial_review_required" in reasons
    assert requires_editorial_review(resource)


def test_official_review_policy_is_configurable(monkeypatch):
    from interactive_bible.config import get_settings

    monkeypatch.setattr(get_settings(), "official_requires_review", False)
    assert route(0.97, False, [], OFFICIAL)[0] == "published"


def test_route_keeps_existing_review_flags_and_reasons():
    status, needs_review, reasons = route(0.93, True, ["audit_needs_review"], COMMUNITY)
    assert (status, needs_review) == ("published", True) and reasons == ["audit_needs_review"]


@pytest.mark.parametrize("conf,band", [(0.97, "very_high"), (0.95, "very_high"), (0.9, "high"), (0.85, "medium"), (0.7, "weak"), (0.2, "low")])
def test_confidence_bands(conf, band):
    assert confidence_band(conf) == band


def test_ai_related_mapping_is_labelled_ai_related():
    """AC-06: an ai_related mapping is shown as "AI Related"."""
    label = display_label("ai_related", 0.93, False)
    assert (label["type"], label["label"], label["human_verified"]) == ("ai_related", "AI Related", False)


def test_unverified_085_direct_reference_is_shown_as_ai_related():
    """AC-06: a 0.85 direct_reference on non-official content is labelled "AI Related" with a 'possible direct mention' note."""
    label = display_label("direct_reference", 0.85, False)
    assert label["type"] == "ai_related" and label["label"] == "AI Related"
    assert label["detected_type"] == "direct_reference"
    assert "possible direct mention" in (label["note"] or "").lower()
    assert label["confidence_label"] == "Medium confidence"


@pytest.mark.parametrize("rtype,text", [("direct_reference", "Direct Mention"), ("scripture_quote", "Scripture Quote"), ("contextual_reference", "Contextual Reference")])
def test_high_confidence_explicit_mappings_keep_their_label(rtype, text):
    """AC-06: >=0.90 explicit relationships keep their own label (e.g. "Direct Mention")."""
    label = display_label(rtype, 0.9, False)
    assert (label["type"], label["label"], label["note"]) == (rtype, text, None)


def test_human_verified_mapping_keeps_detected_type_and_highest_provenance():
    """AC-06: human-verified mappings show human_verified=true and are never downgraded to AI Related."""
    label = display_label("direct_reference", 0.84, True)
    assert label["human_verified"] is True
    assert (label["type"], label["label"], label["trust"]) == ("direct_reference", "Direct Mention", "Highest provenance")

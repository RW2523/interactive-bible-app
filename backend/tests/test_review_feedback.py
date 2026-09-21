"""Editorial review (REV-01..REV-07), RBAC on /v1/admin, audit trail with previous/new values (REV-04),
user feedback thresholds (spec §12.1) and cache invalidation after human decisions."""
from __future__ import annotations

import re

import pytest

from .support import (
    ADMIN,
    EDITOR,
    MEMBER,
    OUTSIDER,
    auth_headers,
    create_resource,
    link_by_ref,
    process_now,
    sql,
    sql_one,
)

TEXT = ("# Promises\n\nRead Romans 8:28 and Romans 8:29 together. Now look at verse thirty-one: if God is for us, who can be against us?\n\n"
        "# Passage\n\nTonight we study Romans 8:35-37 about the love of Christ.")


@pytest.fixture
def mapped(client, login):
    rid = create_resource(client, login(MEMBER), type="native", title="Review target", body_text=TEXT)["id"]
    assert process_now(rid)["status"] == "succeeded"
    return {"rid": rid, **{ref: link_by_ref(rid, ref) for ref in ("ROM.8.28", "ROM.8.29", "ROM.8.31", "ROM.8.35-ROM.8.37")}}


@pytest.fixture
def official(client, login):
    rid = create_resource(client, login(EDITOR), type="native", title="Official sermon", body_text="Please turn to John 3:16 with me.", is_official=True)["id"]
    process_now(rid)
    return {"rid": rid, "JHN.3.16": link_by_ref(rid, "JHN.3.16")}


def actions(object_id: str) -> list[dict]:
    return sql("SELECT action, reviewer_id, previous_value, new_value, note FROM review_actions WHERE object_id = :id ORDER BY created_at", id=object_id)


# ----------------------------------------------------------------------------- RBAC
def _admin_routes():
    from interactive_bible.api.main import app

    for path, operations in app.openapi()["paths"].items():
        if path.startswith("/v1/admin"):
            for method in operations:
                yield method.upper(), re.sub(r"\{[^}]+\}", "x", path)


@pytest.mark.parametrize("method,path", sorted(set(_admin_routes())))
def test_rbac_admin_endpoints_require_editor_role(client, method, path):
    """RBAC: every /v1/admin endpoint is 401 for anonymous users and 403 for members/outsiders."""
    body = {} if method in ("POST", "PATCH") else None
    assert client.request(method, path, json=body).status_code == 401
    for who in (MEMBER, OUTSIDER):
        assert client.request(method, path, json=body, headers=auth_headers(who)).status_code == 403


def test_rbac_admin_routes_exist():
    routes = set(_admin_routes())
    assert ("POST", "/v1/admin/mappings/x/approve") in routes and ("GET", "/v1/admin/review-queue") in routes and len(routes) >= 20


def test_editor_and_admin_can_use_the_review_queue(client, login, mapped):
    for who in (EDITOR, ADMIN):
        assert client.get("/v1/admin/review-queue", headers=login(who)).status_code == 200


# ----------------------------------------------------------------------------- REV-01 queue + filters
def test_rev01_review_queue_filters(client, login, mapped, official):
    """REV-01 The review queue lists open items and filters by status, type, confidence, official flag, reason, verse and resource."""
    editor = login(EDITOR)

    def queue(**params):
        resp = client.get("/v1/admin/review-queue", params=params, headers=editor)
        assert resp.status_code == 200, resp.text
        return resp.json()

    open_items = queue()
    open_refs = {i["verse_ref"] for i in open_items["items"]}
    assert open_refs == {"ROM.8.31", "JHN.3.16"}  # uncertain inferred verse + everything on official content
    assert open_items["facets"]["open"] == 2 and open_items["facets"]["status"] == {"published": 4, "pending_review": 1}
    assert open_items["items"][0]["resource"]["is_official"] is True  # official first by default
    assert {i["verse_ref"] for i in queue(official="true")["items"]} == {"JHN.3.16"}
    assert {i["verse_ref"] for i in queue(official="false")["items"]} == {"ROM.8.31"}
    assert {i["verse_ref"] for i in queue(reason="editorial_review_required")["items"]} == {"JHN.3.16"}
    assert {i["verse_ref"] for i in queue(reason="uncertain_confidence_band")["items"]} == {"ROM.8.31"}
    assert {i["verse_ref"] for i in queue(max_confidence=0.9)["items"]} == {"ROM.8.31"}
    assert {i["verse_ref"] for i in queue(min_confidence=0.9)["items"]} == {"JHN.3.16"}
    assert {i["verse_ref"] for i in queue(status="published")["items"]} == {"ROM.8.28", "ROM.8.29", "ROM.8.31", "ROM.8.35-ROM.8.37"}
    assert {i["verse_ref"] for i in queue(status="pending_review")["items"]} == {"JHN.3.16"}
    assert queue(status="all")["total"] == 5
    assert {i["verse_ref"] for i in queue(status="all", verse="ROM.8.36")["items"]} == {"ROM.8.35-ROM.8.37"}
    assert {i["verse_ref"] for i in queue(status="all", resource_id=official["rid"])["items"]} == {"JHN.3.16"}
    assert queue(status="all", relationship_type="scripture_quote")["total"] == 0
    assert queue(status="all", relationship_type="direct_reference", page_size=2)["total"] == 5
    assert len(queue(status="all", page_size=2, page=3)["items"]) == 1
    confidences = [i["confidence"] for i in queue(status="all", sort="confidence")["items"]]
    assert confidences == sorted(confidences)
    item = next(i for i in open_items["items"] if i["verse_ref"] == "ROM.8.31")
    assert item["segment"]["id"] == mapped["ROM.8.31"]["segment_id"] and item["evidence_text"]


def test_rev_mapping_detail_exposes_context_texts_history_and_provenance(client, login, mapped):
    """AC-15 The review detail endpoint exposes provenance, evidence, verse texts and history."""
    link = mapped["ROM.8.31"]
    body = client.get(f"/v1/admin/mappings/{link['id']}", headers=login(EDITOR)).json()
    mapping = body["mapping"]
    assert mapping["verse_ref"] == "ROM.8.31" and mapping["provenance"]["source"] == "pipeline"
    assert {"pipeline_version", "run_id", "detectors", "signals"} <= set(mapping["provenance"])
    assert mapping["provenance"]["signals"]["direct_reference"]["parser"]["flags"] == ["context_chapter"]
    assert mapping["label"]["label"] == "AI Related" and mapping["evidence_text"]
    assert set(body["verse_texts"]["ROM.8.31"]) == {"web", "kjv", "asv"}
    assert {m["verse_ref"] for m in body["segment_mappings"]} == {"ROM.8.28", "ROM.8.29", "ROM.8.31"}
    assert body["context"]["after"]["heading"] == "Passage" and body["resource"]["title"] == "Review target"
    assert client.get("/v1/admin/mappings/map_missing", headers=login(EDITOR)).status_code == 404


# ----------------------------------------------------------------------------- REV-02..REV-04 actions + audit
def test_rev04_approve_and_reject_write_previous_and_new_values(client, login, mapped):
    """REV-04 Approve and reject update the mapping (and its passage children) and write review_actions with previous/new values."""
    approve = client.post(f"/v1/admin/mappings/{mapped['ROM.8.31']['id']}/approve", json={"note": "clear from context"}, headers=login(EDITOR))
    assert approve.status_code == 200 and approve.json()["mapping"]["review_status"] == "approved"
    (a,) = actions(mapped["ROM.8.31"]["id"])
    assert a["action"] == "approve" and a["reviewer_id"] == "usr_editor" and a["note"] == "clear from context"
    assert a["previous_value"]["review_status"] == "published" and a["previous_value"]["is_human_verified"] is False and a["previous_value"]["verse_ref"] == "ROM.8.31"
    assert a["new_value"] == {"review_status": "approved", "is_human_verified": True}

    passage = mapped["ROM.8.35-ROM.8.37"]
    assert client.delete(f"/v1/admin/mappings/{passage['id']}", params={"note": "wrong passage"}, headers=login(EDITOR)).json() == {"mapping_id": passage["id"], "review_status": "rejected"}
    (r,) = actions(passage["id"])
    assert (r["action"], r["previous_value"]["review_status"], r["new_value"], r["note"]) == ("reject", "published", {"review_status": "rejected"}, "wrong passage")
    children = sql("SELECT review_status, is_human_verified FROM verse_resource_links WHERE parent_link_id = :p", p=passage["id"])
    assert len(children) == 3 and all(c == {"review_status": "rejected", "is_human_verified": True} for c in children)
    assert client.get(f"/v1/resources/{mapped['rid']}/verse-links").json()["total"] == 3


def test_rev04_edit_changes_type_confidence_and_verse_with_audit(client, login, mapped):
    link = mapped["ROM.8.29"]
    resp = client.patch(f"/v1/admin/mappings/{link['id']}", json={"relationship_type": "scripture_quote", "confidence_override": 0.97,
                                                                   "why_related": "Editor note", "verse_ref": "ROM.8.30", "note": "typo in source"}, headers=login(EDITOR))
    assert resp.status_code == 200, resp.text
    mapping = resp.json()["mapping"]
    assert (mapping["verse_ref"], mapping["relationship_type"], mapping["confidence_override"], mapping["review_status"], mapping["is_human_verified"]) == \
        ("ROM.8.30", "scripture_quote", pytest.approx(0.97), "approved", True)
    assert mapping["provenance"]["human_edit"] is True and mapping["provenance"]["edited_by"] == "usr_editor"
    (e,) = actions(link["id"])
    assert e["action"] == "edit" and e["previous_value"]["verse_ref"] == "ROM.8.29" and e["previous_value"]["relationship_type"] == "direct_reference"
    assert e["new_value"] == {"relationship_type": "scripture_quote", "confidence_override": 0.97, "why_related": "Editor note", "verse_ref": "ROM.8.30"}
    # conflicting verse change is refused
    conflict = client.patch(f"/v1/admin/mappings/{link['id']}", json={"verse_ref": "ROM.8.28"}, headers=login(EDITOR))
    assert conflict.status_code == 422 and "merge instead" in conflict.json()["detail"]
    assert client.patch(f"/v1/admin/mappings/{link['id']}", json={"verse_ref": "not a verse"}, headers=login(EDITOR)).status_code == 422


def test_rev04_add_mapping_is_human_approved_with_audit(client, login, mapped):
    seg = mapped["ROM.8.28"]["segment_id"]
    resp = client.post("/v1/admin/mappings", json={"segment_id": seg, "verse_ref": "Romans 8:26-27", "relationship_type": "contextual_reference",
                                                     "evidence_text": "Read Romans 8:28", "why_related": "Same argument", "note": "missed context"}, headers=login(EDITOR))
    assert resp.status_code == 201, resp.text
    mapping = resp.json()["mapping"]
    assert (mapping["verse_ref"], mapping["review_status"], mapping["is_human_verified"], mapping["confidence"]) == ("ROM.8.26-ROM.8.27", "approved", True, 1.0)
    segment_text = sql_one("SELECT text_normalized FROM resource_segments WHERE id = :s", s=seg)["text_normalized"]
    start = segment_text.index("Read Romans 8:28")
    assert mapping["provenance"] == {"source": "human", "created_by": "usr_editor"} and mapping["evidence_offsets"] == [{"start": start, "end": start + 16}]
    assert len(sql("SELECT id FROM verse_resource_links WHERE parent_link_id = :p", p=mapping["id"])) == 2
    (a,) = actions(mapping["id"])
    assert a["action"] == "add" and a["previous_value"] is None
    assert a["new_value"] == {"verse_ref": "Romans 8:26-27", "segment_id": seg, "relationship_type": "contextual_reference"}
    # adding an existing verse edits (approves) it instead of duplicating
    again = client.post("/v1/admin/mappings", json={"segment_id": seg, "verse_ref": "ROM.8.28", "relationship_type": "direct_reference"}, headers=login(EDITOR))
    assert again.status_code == 201 and again.json()["mapping"]["id"] == mapped["ROM.8.28"]["id"] and again.json()["mapping"]["review_status"] == "approved"
    assert client.post("/v1/admin/mappings", json={"segment_id": "seg_missing", "verse_ref": "ROM.8.28"}, headers=login(EDITOR)).status_code == 404


def test_rev04_merge_mappings_into_a_passage(client, login, mapped):
    ids = [mapped["ROM.8.28"]["id"], mapped["ROM.8.29"]["id"]]
    resp = client.post("/v1/admin/mappings/merge", json={"mapping_ids": ids, "note": "one citation"}, headers=login(EDITOR))
    assert resp.status_code == 200, resp.text
    merged = resp.json()["mapping"]
    assert merged["verse_ref"] == "ROM.8.28-ROM.8.29" and merged["review_status"] == "approved" and merged["mention_count"] == 2
    assert link_by_ref(mapped["rid"], "ROM.8.29") is None
    children = sql("SELECT verse_id FROM verse_resource_links WHERE parent_link_id = :p ORDER BY verse_id", p=merged["id"])
    assert [c["verse_id"] for c in children] == [45008028, 45008029]
    (m,) = actions(merged["id"])
    assert m["action"] == "merge" and m["note"] == "one citation"
    assert [p["verse_ref"] for p in m["previous_value"]] == ["ROM.8.28", "ROM.8.29"] and m["new_value"]["verse_ref"] == "ROM.8.28-ROM.8.29"
    other_segment = mapped["ROM.8.35-ROM.8.37"]["id"]
    bad = client.post("/v1/admin/mappings/merge", json={"mapping_ids": [merged["id"], other_segment]}, headers=login(EDITOR))
    assert bad.status_code == 422 and "same segment" in bad.json()["detail"]


def test_rev04_primary_verse_and_tags_changes_are_audited(client, login, mapped):
    seg = mapped["ROM.8.28"]["segment_id"]
    previous_primary = sql_one("SELECT id FROM verse_resource_links WHERE segment_id = :s AND primary_flag", s=seg)
    resp = client.post(f"/v1/admin/segments/{seg}/primary", json={"mapping_id": mapped["ROM.8.31"]["id"], "note": "the real focus"}, headers=login(EDITOR))
    assert resp.json() == {"segment_id": seg, "primary_mapping": mapped["ROM.8.31"]["id"]}
    assert [r["id"] for r in sql("SELECT id FROM verse_resource_links WHERE segment_id = :s AND primary_flag", s=seg)] == [mapped["ROM.8.31"]["id"]]
    (p,) = actions(seg)
    assert p["action"] == "change_primary_verse" and p["previous_value"] == {"primary_mapping": previous_primary["id"] if previous_primary else None}
    assert client.post(f"/v1/admin/segments/{seg}/primary", json={"mapping_id": mapped["ROM.8.35-ROM.8.37"]["id"]}, headers=login(EDITOR)).status_code == 422

    tags = client.patch(f"/v1/admin/segments/{seg}/tags", json={"add_topics": ["topic_providence"], "remove_topics": ["topic_hope"], "note": "better theme"}, headers=login(EDITOR))
    assert "topic_providence" in tags.json()["topics"] and "topic_hope" not in tags.json()["topics"]
    t = actions(seg)[-1]
    assert t["action"] == "edit_tags" and "topic_providence" in t["new_value"]["topics"] and "topic_providence" not in t["previous_value"]["topics"]
    assert sql_one("SELECT is_human, confidence FROM segment_topics WHERE segment_id = :s AND topic_id = 'topic_providence'", s=seg) == {"is_human": True, "confidence": 1.0}


def test_audit_log_endpoint_filters(client, login, mapped):
    client.post(f"/v1/admin/mappings/{mapped['ROM.8.31']['id']}/approve", headers=login(EDITOR))
    client.post(f"/v1/admin/mappings/{mapped['ROM.8.28']['id']}/approve", headers=login(ADMIN))
    log = client.get("/v1/admin/audit", params={"object_type": "mapping"}, headers=login(EDITOR)).json()
    assert log["total"] == 2 and {i["reviewer_email"] for i in log["items"]} == {EDITOR, ADMIN}
    by_admin = client.get("/v1/admin/audit", params={"reviewer_id": "usr_admin"}, headers=login(EDITOR)).json()
    assert [i["object_id"] for i in by_admin["items"]] == [mapped["ROM.8.28"]["id"]]


# ----------------------------------------------------------------------------- cache invalidation
def test_intelligence_cache_is_invalidated_by_approval(client, login, mapped):
    """Verse Intelligence payloads are cached per content version and change right after an editorial approval."""
    first = client.get("/v1/verses/ROM.8.31/intelligence").json()
    assert first["provenance"]["cache"] == "miss"
    card = next(c for c in first["top_resources"] if c["resource"]["id"] == mapped["rid"])
    assert card["relationship"]["human_verified"] is False and card["relationship"]["label"] == "AI Related"
    assert client.get("/v1/verses/ROM.8.31/intelligence").json()["provenance"]["cache"] == "hit"
    client.post(f"/v1/admin/mappings/{mapped['ROM.8.31']['id']}/approve", headers=login(EDITOR))
    after = client.get("/v1/verses/ROM.8.31/intelligence").json()
    assert after["provenance"]["cache"] == "miss" and after["provenance"]["cache_version"] != first["provenance"]["cache_version"]
    card = next(c for c in after["top_resources"] if c["resource"]["id"] == mapped["rid"])
    assert card["relationship"]["human_verified"] is True and card["relationship"]["label"] == "Direct Mention"


def test_search_cache_is_invalidated_by_rejection(client, login, mapped):
    query = {"query": "Romans 8:31", "scope": "resources"}
    before = client.post("/v1/search/scripture", json=query).json()
    top = before["segments"][0]
    assert top["segment_id"] == mapped["ROM.8.31"]["segment_id"] and top["verse_ref"] == "ROM.8.31" and "Direct mention of Romans 8:31" in top["reasons"]
    assert client.post("/v1/search/scripture", json=query).json()["cache"] == "hit"
    client.delete(f"/v1/admin/mappings/{mapped['ROM.8.31']['id']}", headers=login(EDITOR))
    after = client.post("/v1/search/scripture", json=query).json()
    assert after["cache"] == "miss"
    assert all(s["verse_ref"] != "ROM.8.31" and "Direct mention of Romans 8:31" not in s["reasons"] for s in after["segments"])


# ----------------------------------------------------------------------------- feedback (spec §12.1)
def feedback(client, who, mapping_id, kind="not_relevant", note=None):
    return client.post("/v1/feedback", json={"object_type": "mapping", "object_id": mapping_id, "kind": kind, "note": note}, headers=auth_headers(who) if who else {})


def test_feedback_single_report_queues_review_but_keeps_mapping_published(client, login, mapped):
    """Feedback: one report enters the review queue but does not hide the mapping."""
    link = mapped["ROM.8.28"]
    resp = feedback(client, MEMBER, link["id"], note="This paragraph is about 8:29")
    assert resp.status_code == 201 and resp.json()["status"] == "open" and "mapping_hidden_pending_review" not in resp.json()
    row = sql_one("SELECT review_status, needs_review, review_reasons, feedback_count FROM verse_resource_links WHERE id = :id", id=link["id"])
    assert row == {"review_status": "published", "needs_review": True, "review_reasons": ["user_reported_not_relevant"], "feedback_count": 1}
    queue = client.get("/v1/admin/review-queue", params={"status": "flagged"}, headers=login(EDITOR)).json()
    assert [i["mapping_id"] for i in queue["items"]] == [link["id"]]
    listed = client.get("/v1/admin/feedback", headers=login(EDITOR)).json()
    assert listed["total"] == 1 and listed["items"][0]["verse_ref"] == "ROM.8.28" and listed["items"][0]["resource_title"] == "Review target"
    assert feedback(client, MEMBER, link["id"]).json() == {"id": resp.json()["id"], "status": "duplicate_ignored"}
    assert sql_one("SELECT count(*) AS n FROM analytics_events WHERE type = 'feedback'")["n"] == 1


def test_feedback_threshold_hides_mapping_pending_review(client, login, mapped):
    """Feedback: only FEEDBACK_HIDE_THRESHOLD (3) reports move a published mapping to pending_review (hidden)."""
    link = mapped["ROM.8.35-ROM.8.37"]
    assert any(c["mapping_id"] for c in client.get("/v1/verses/ROM.8.35/intelligence").json()["top_resources"])
    for n, who in enumerate((MEMBER, OUTSIDER), start=1):
        assert "mapping_hidden_pending_review" not in feedback(client, who, link["id"], kind="wrong_verse").json()
        assert sql_one("SELECT review_status FROM verse_resource_links WHERE id = :id", id=link["id"])["review_status"] == "published"
    third = feedback(client, ADMIN, link["id"], kind="wrong_verse").json()
    assert third["mapping_hidden_pending_review"] is True
    rows = sql("SELECT review_status FROM verse_resource_links WHERE id = :id OR parent_link_id = :id", id=link["id"])
    assert len(rows) == 4 and {r["review_status"] for r in rows} == {"pending_review"}
    (audit,) = [a for a in actions(link["id"]) if a["action"] == "auto_hidden_by_feedback_threshold"]
    assert audit["previous_value"] == {"review_status": "published"} and audit["new_value"] == {"review_status": "pending_review", "reports": 3}
    assert all(c["resource"]["id"] != mapped["rid"] for c in client.get("/v1/verses/ROM.8.35/intelligence").json()["top_resources"])
    # an editor's approval restores it and resolves the reports
    client.post(f"/v1/admin/mappings/{link['id']}/approve", headers=login(EDITOR))
    assert {f["status"] for f in sql("SELECT status FROM feedback WHERE object_id = :id", id=link["id"])} == {"resolved"}


def test_feedback_threshold_is_configurable(client, login, mapped, monkeypatch):
    from interactive_bible.config import get_settings

    monkeypatch.setattr(get_settings(), "feedback_hide_threshold", 1)
    assert feedback(client, OUTSIDER, mapped["ROM.8.28"]["id"]).json()["mapping_hidden_pending_review"] is True


def test_helpful_feedback_does_not_queue_review(client, login, mapped):
    """Feedback: 'helpful' is recorded (resolved) without touching the mapping or the review queue."""
    link = mapped["ROM.8.28"]
    for who in (MEMBER, OUTSIDER, ADMIN, None):
        assert feedback(client, who, link["id"], kind="helpful").json()["status"] == "resolved"
    row = sql_one("SELECT review_status, needs_review, feedback_count, review_reasons FROM verse_resource_links WHERE id = :id", id=link["id"])
    assert row == {"review_status": "published", "needs_review": False, "feedback_count": 0, "review_reasons": []}
    assert client.get("/v1/admin/review-queue", params={"status": "flagged"}, headers=login(EDITOR)).json()["total"] == 0


def test_feedback_never_hides_human_verified_mappings(client, login, mapped):
    link = mapped["ROM.8.28"]
    client.post(f"/v1/admin/mappings/{link['id']}/approve", headers=login(EDITOR))
    for who in (MEMBER, OUTSIDER, ADMIN):
        assert "mapping_hidden_pending_review" not in feedback(client, who, link["id"]).json()
    assert sql_one("SELECT review_status FROM verse_resource_links WHERE id = :id", id=link["id"])["review_status"] == "approved"


def test_feedback_validation_and_editor_resolution(client, login, mapped):
    assert client.post("/v1/feedback", json={"object_type": "mapping", "object_id": "map_nope", "kind": "not_relevant"}).status_code == 404
    assert client.post("/v1/feedback", json={"object_type": "mapping", "object_id": "x", "kind": "spam"}).status_code == 422
    seg_report = client.post("/v1/feedback", json={"object_type": "segment", "object_id": mapped["ROM.8.28"]["segment_id"], "kind": "report_content", "note": "offensive"})
    assert seg_report.status_code == 201
    fid = seg_report.json()["id"]
    assert client.patch(f"/v1/admin/feedback/{fid}", json={"status": "dismissed", "note": "not offensive"}, headers=login(EDITOR)).json() == {"id": fid, "status": "dismissed"}
    (a,) = actions(fid)
    assert (a["action"], a["previous_value"], a["new_value"], a["note"]) == ("feedback_dismissed", {"status": "open"}, {"status": "dismissed"}, "not offensive")
    assert sql_one("SELECT resolved_at IS NOT NULL AS done FROM feedback WHERE id = :id", id=fid)["done"] is True


def test_feedback_threshold_requires_distinct_reporters(client, login, mapped):
    link = mapped["ROM.8.28"]
    for kind in ("not_relevant", "wrong_verse", "wrong_timestamp"):
        feedback(client, None, link["id"], kind=kind)
    assert sql_one("SELECT review_status FROM verse_resource_links WHERE id = :id", id=link["id"])["review_status"] == "published"


def test_feedback_hiding_a_passage_invalidates_every_verse_in_it(client, login, mapped):
    link = mapped["ROM.8.35-ROM.8.37"]
    before = client.get("/v1/verses/ROM.8.36/intelligence").json()
    assert mapped["rid"] in {c["resource"]["id"] for c in before["top_resources"]}
    for who in (MEMBER, OUTSIDER, ADMIN):
        feedback(client, who, link["id"], kind="wrong_verse")
    assert client.get("/v1/verses/ROM.8.36/resources").json()["total"] == 0  # uncached endpoint is already correct
    after = client.get("/v1/verses/ROM.8.36/intelligence").json()
    assert mapped["rid"] not in {c["resource"]["id"] for c in after["top_resources"]}


@pytest.fixture
def lenient_client(_app_client):
    from fastapi.testclient import TestClient

    from interactive_bible.api.main import app

    return TestClient(app, raise_server_exceptions=False)


def test_feedback_on_non_numeric_verse_relationship_id_is_a_client_error(lenient_client):
    resp = lenient_client.post("/v1/feedback", json={"object_type": "verse_relationship", "object_id": "abc", "kind": "not_relevant"})
    assert resp.status_code in (404, 422), resp.text


def test_feedback_on_verse_relationship(client, login):
    rel = sql_one("SELECT id FROM verse_relationships WHERE source = 'openbible' AND from_verse_id = 45008028 ORDER BY confidence DESC LIMIT 1")
    resp = client.post("/v1/feedback", json={"object_type": "verse_relationship", "object_id": str(rel["id"]), "kind": "not_relevant"}, headers=login(MEMBER))
    assert resp.status_code == 201 and resp.json()["status"] == "open"
    assert client.post("/v1/feedback", json={"object_type": "verse_relationship", "object_id": "999999999", "kind": "helpful"}).status_code == 404


def test_clip_edit_without_boundaries_is_rejected_cleanly(lenient_client, mapped):
    seg = mapped["ROM.8.28"]["segment_id"]
    resp = lenient_client.patch(f"/v1/admin/segments/{seg}/clip", json={"reason": "tighter"}, headers=auth_headers(EDITOR))
    assert resp.status_code == 422, resp.text


def test_login_is_rate_limited(client):
    statuses = [client.post("/v1/auth/login", json={"email": "nobody@example.org", "password": "x"}).status_code for _ in range(21)]
    assert statuses[:20] == [401] * 20 and statuses[20] == 429

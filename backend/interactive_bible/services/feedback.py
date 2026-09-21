"""User feedback (spec §12.1): analytics events + editorial review items, with a policy threshold before hiding."""
from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from .. import cache
from ..config import get_settings
from ..db import execute, fetch_all, fetch_one, json_dumps
from ..ids import new_id
from ..security import Viewer
from .bible import NotFound
from .resources import Forbidden, audit

MAPPING_ERRORS = {"not_relevant", "wrong_verse", "wrong_timestamp", "wrong_quote_reference"}


def submit(session: Session, viewer: Viewer, data: dict[str, Any], client_key: str) -> dict[str, Any]:
    kind, object_type, object_id = data["kind"], data["object_type"], data["object_id"]
    fid = new_id("fb")
    target = None
    if object_type == "mapping":
        target = fetch_one(session, "SELECT id, verse_id, end_verse_id, resource_id, is_human_verified, review_status FROM verse_resource_links WHERE id = :id", id=object_id)
    elif object_type == "segment":
        target = fetch_one(session, "SELECT id FROM resource_segments WHERE id = :id", id=object_id)
    elif object_type == "resource":
        target = fetch_one(session, "SELECT id FROM resources WHERE id = :id AND deleted_at IS NULL", id=object_id)
    elif object_type == "verse_relationship":
        if not str(object_id).isdigit():
            raise NotFound("feedback target not found")
        target = fetch_one(session, "SELECT id FROM verse_relationships WHERE id = CAST(:id AS bigint)", id=object_id)
    if not target:
        raise NotFound("feedback target not found")
    dup = fetch_one(session, "SELECT id FROM feedback WHERE object_type = :ot AND object_id = :oid AND kind = :k AND client_key = :ck AND created_at > now() - interval '1 day'",
                    ot=object_type, oid=object_id, k=kind, ck=client_key)
    if dup:
        return {"id": dup["id"], "status": "duplicate_ignored"}
    status = "open" if kind != "helpful" else "resolved"
    execute(session, "INSERT INTO feedback (id, user_id, object_type, object_id, kind, note, status, client_key) VALUES (:id, :u, :ot, :oid, :k, :note, :st, :ck)",
            id=fid, u=viewer.user_id, ot=object_type, oid=object_id, k=kind, note=(data.get("note") or "")[:2000] or None, st=status, ck=client_key)
    execute(session, "INSERT INTO analytics_events (type, user_id, payload) VALUES ('feedback', :u, CAST(:p AS jsonb))",
            u=viewer.user_id, p=json_dumps({"feedback_id": fid, "kind": kind, "object_type": object_type, "object_id": object_id}))
    result: dict[str, Any] = {"id": fid, "status": status}
    if object_type == "mapping" and kind in MAPPING_ERRORS:
        execute(session, """UPDATE verse_resource_links SET feedback_count = feedback_count + 1, needs_review = true,
                               review_reasons = array(SELECT DISTINCT unnest(review_reasons || ARRAY['user_reported_' || :k])), updated_at = now() WHERE id = :id""",
                k=kind, id=object_id)
        # policy threshold counts independent reporters, so one user/IP cannot hide a mapping alone
        count = fetch_one(session, """SELECT count(DISTINCT coalesce(user_id, client_key)) AS n FROM feedback
                                      WHERE object_type = 'mapping' AND object_id = :id AND kind = ANY(:kinds) AND status IN ('open', 'in_review')""",
                          id=object_id, kinds=list(MAPPING_ERRORS))["n"]
        threshold = get_settings().feedback_hide_threshold
        if count >= threshold and not target["is_human_verified"] and target["review_status"] == "published":
            execute(session, "UPDATE verse_resource_links SET review_status = 'pending_review', updated_at = now() WHERE id = :id", id=object_id)
            execute(session, "UPDATE verse_resource_links SET review_status = 'pending_review' WHERE parent_link_id = :id", id=object_id)
            audit(session, viewer, "mapping", object_id, "auto_hidden_by_feedback_threshold", {"review_status": "published"}, {"review_status": "pending_review", "reports": count})
            result["mapping_hidden_pending_review"] = True
            from ..pipeline.persist import refresh_resource_derived_data

            refresh_resource_derived_data(session, target["resource_id"])
        from ..bible.refparser import verse_ordinals

        cache.bump_verses(session, verse_ordinals(target["verse_id"], target["end_verse_id"] or target["verse_id"])[:500])
    return result


def list_feedback(session: Session, viewer: Viewer, status: str | None, kind: str | None, page: int, page_size: int) -> dict[str, Any]:
    if not viewer.is_editor:
        raise Forbidden("editor role required")
    where, params = ["true"], {}
    if status:
        where.append("f.status = ANY(:st)")
        params["st"] = status.split(",")
    if kind:
        where.append("f.kind = ANY(:k)")
        params["k"] = kind.split(",")
    w = " AND ".join(where)
    total = fetch_one(session, f"SELECT count(*) AS n FROM feedback f WHERE {w}", **params)["n"]
    rows = fetch_all(session, f"""SELECT f.*, u.display_name AS user_name, l.verse_id, l.end_verse_id, l.relationship_type, l.review_status AS mapping_status, r.title AS resource_title
                                  FROM feedback f LEFT JOIN users u ON u.id = f.user_id
                                  LEFT JOIN verse_resource_links l ON f.object_type = 'mapping' AND l.id = f.object_id
                                  LEFT JOIN resources r ON r.id = coalesce(l.resource_id, CASE WHEN f.object_type = 'resource' THEN f.object_id END)
                                  WHERE {w} ORDER BY f.created_at DESC LIMIT :limit OFFSET :offset""", limit=page_size, offset=(max(1, page) - 1) * page_size, **params)
    from ..bible import books as B

    for r in rows:
        r["verse_ref"] = B.canonical_range_str(r["verse_id"], r["end_verse_id"]) if r.get("verse_id") else None
    summary = fetch_all(session, "SELECT kind, status, count(*) AS n FROM feedback GROUP BY kind, status")
    return {"total": total, "items": rows, "summary": summary, "page": page, "page_size": page_size}


def update_feedback(session: Session, viewer: Viewer, feedback_id: str, status: str, note: str | None) -> dict[str, Any]:
    if not viewer.is_editor:
        raise Forbidden("editor role required")
    row = fetch_one(session, "SELECT * FROM feedback WHERE id = :id", id=feedback_id)
    if not row:
        raise NotFound("feedback not found")
    execute(session, "UPDATE feedback SET status = :st, resolved_at = CASE WHEN :st IN ('resolved','dismissed') THEN now() ELSE NULL END WHERE id = :id", st=status, id=feedback_id)
    audit(session, viewer, "feedback", feedback_id, f"feedback_{status}", {"status": row["status"]}, {"status": status}, note)
    return {"id": feedback_id, "status": status}

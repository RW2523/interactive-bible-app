"""Scripture Map (spec §6): a focused relationship neighbourhood over data stored by the tagger (graph + accessible list)."""
from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from ..bible import books as B
from ..db import fetch_all, fetch_one
from ..security import Viewer, visibility_clause
from ..vocab.service import load_entities
from . import related
from .bible import NotFound
from .intelligence import entities_for, resolve_ref, themes_for, visible_cards

MAX_NODES = 60


class Graph:
    def __init__(self) -> None:
        self.nodes: dict[str, dict[str, Any]] = {}
        self.edges: dict[tuple[str, str, str], dict[str, Any]] = {}

    def node(self, nid: str, ntype: str, label: str, score: float = 0.5, **meta: Any) -> str:
        cur = self.nodes.get(nid)
        if cur is None:
            self.nodes[nid] = {"id": nid, "type": ntype, "label": label, "score": round(score, 3), **meta}
        else:
            cur["score"] = max(cur["score"], round(score, 3))
        return nid

    def edge(self, source: str, target: str, etype: str, label: str, confidence: float | None = None, **meta: Any) -> None:
        key = (source, target, etype)
        if key not in self.edges:
            self.edges[key] = {"id": f"{source}->{target}:{etype}", "source": source, "target": target, "type": etype, "label": label,
                               "confidence": round(confidence, 3) if confidence is not None else None, **meta}

    def to_dict(self, root: str) -> dict[str, Any]:
        nodes = sorted(self.nodes.values(), key=lambda n: (n["id"] != root, -n["score"]))[:MAX_NODES]
        keep = {n["id"] for n in nodes}
        edges = [e for e in self.edges.values() if e["source"] in keep and e["target"] in keep]
        return {"root": root, "nodes": nodes, "edges": edges, "truncated": len(self.nodes) > MAX_NODES}


def _edge_allowed(rel_type: str | None, human: bool, filters: dict[str, Any]) -> bool:
    if filters.get("human_verified_only") and not human:
        return False
    if filters.get("direct_only") and rel_type != "direct_reference":
        return False
    if filters.get("explicit_only") and rel_type not in ("direct_reference", "scripture_quote"):
        return False
    return True


def _include(kind: str, filters: dict[str, Any]) -> bool:
    types = filters.get("types")
    return not types or kind in types


def _verse_neighbourhood(session: Session, viewer: Viewer, g: Graph, start: int, end: int, filters: dict[str, Any], depth: int) -> str:
    root = g.node(f"verse:{B.canonical_range_str(start, end if end != start else None)}", "verse", B.display_ref(start, end if end != start else None), 1.0,
                  ref=B.canonical_range_str(start, end if end != start else None))
    code = B.from_ordinal(start)[0]
    if _include("books", filters):
        book = B.BY_CODE[code]
        g.node(f"book:{code}", "book", book.name, 0.4, testament=book.testament, genre=book.genre)
        g.edge(root, f"book:{code}", "IN_BOOK", "In book")
    cards = visible_cards(session, viewer, start, end)
    if _include("resources", filters):
        for c in cards[:10]:
            rel = c["relationship"]
            if not _edge_allowed(rel["detected_type"], rel["human_verified"], filters):
                continue
            seg_id = f"segment:{c['segment_id']}"
            res_id = f"resource:{c['resource']['id']}"
            g.node(res_id, "resource", c["resource"]["title"], c["rank_score"], resource_type=c["resource"]["type"], category=c["resource"]["category"])
            g.node(seg_id, "segment", c.get("segment", {}).get("heading") or _segment_label(c), c["rank_score"], resource_id=c["resource"]["id"], media_kind=c["media_kind"],
                   start_ms=(c.get("clip") or {}).get("start_ms"), page=(c.get("segment") or {}).get("page_start"), summary=c.get("summary"))
            etype = {"direct_reference": "DIRECTLY_MENTIONS", "scripture_quote": "QUOTES", "contextual_reference": "CONTEXTUALLY_REFERENCES", "ai_related": "RELATED_TO"}[rel["detected_type"]]
            g.edge(seg_id, root, etype, rel["label"], rel["confidence"], relationship_type=rel["detected_type"], human_verified=rel["human_verified"], why=c.get("why_related") or c.get("evidence_text"), mapping_id=c["mapping_id"])
            g.edge(res_id, seg_id, "HAS_SEGMENT", "Has section")
            speaker = c["resource"].get("speaker") or c["resource"].get("author")
            if speaker and _include("people", filters):
                sid = f"creator:{speaker.lower()}"
                g.node(sid, "creator", speaker, 0.3)
                g.edge(res_id, sid, "AUTHORED_OR_SPOKEN_BY", "Speaker/author")
    top_segments = [c["segment_id"] for c in cards[:10]]
    if _include("themes", filters) and not (filters.get("direct_only") or filters.get("human_verified_only") or filters.get("explicit_only")):
        for t in themes_for(session, viewer, start, end, top_segments)[:8]:
            tid = g.node(f"topic:{t['slug']}", "topic", t["name"], t["confidence"], slug=t["slug"])
            g.edge(root, tid, "HAS_THEME", "Theme", t["confidence"])
    if not (filters.get("direct_only") or filters.get("human_verified_only") or filters.get("explicit_only")):
        ents = entities_for(session, start, end, top_segments)
        for group, kind in (("people", "people"), ("events", "events"), ("places", "places")):
            if not _include(kind, filters):
                continue
            for e in ents[group][:5]:
                eid = g.node(f"entity:{e['id']}", {"people": "person", "events": "event", "places": "place"}[group], e["name"], e["confidence"], entity_id=e["id"], description=e.get("description"))
                g.edge(root, eid, "INVOLVES", "Involves", e["confidence"])
        if _include("verses", filters):
            for r in related.related_verses(session, viewer, start, end, limit=10):
                rid = g.node(f"verse:{r['ref']}", "verse", r["display_ref"], r["score"], ref=r["ref"], text=r["text"][:200])
                g.edge(root, rid, "RELATED_TO", r["label"], r["score"], relationship_type=r["relationship"], why=r["why"], why_status=r["why_status"], ai=r["is_ai"])
                if depth >= 2:
                    rng = B.parse_canonical_range(r["ref"])
                    if rng:
                        for t in themes_for(session, viewer, rng[0], rng[1], [])[:2]:
                            tid = g.node(f"topic:{t['slug']}", "topic", t["name"], t["confidence"] * 0.6, slug=t["slug"])
                            g.edge(rid, tid, "HAS_THEME", "Theme", t["confidence"])
    return root


def _segment_label(card: dict[str, Any]) -> str:
    clip = card.get("clip") or {}
    if clip.get("start_ms") is not None:
        ms = clip["start_ms"]
        return f"{card['resource']['title']} @ {ms // 60000}:{(ms // 1000) % 60:02d}"
    seg = card.get("segment") or {}
    if seg.get("page_start"):
        return f"{card['resource']['title']} p.{seg['page_start']}"
    return f"{card['resource']['title']} §{(seg.get('ordinal') or 0) + 1}"


def scripture_map(session: Session, viewer: Viewer, root_type: str, root_id: str, filters: dict[str, Any], depth: int = 1) -> dict[str, Any]:
    g = Graph()
    vis, params = visibility_clause(viewer, "r", discoverable=True)
    if root_type == "verse":
        start, end = resolve_ref(root_id)
        root = _verse_neighbourhood(session, viewer, g, start, end, filters, depth)
    elif root_type == "topic":
        topic = fetch_one(session, "SELECT * FROM topics WHERE canonical_slug = :s OR id = :s", s=root_id)
        if not topic:
            raise NotFound("topic not found")
        root = g.node(f"topic:{topic['canonical_slug']}", "topic", topic["name"], 1.0, slug=topic["canonical_slug"])
        for r in fetch_all(session, """SELECT vt.verse_id, max(vt.confidence) AS c FROM verse_topics vt WHERE vt.topic_id = :t GROUP BY vt.verse_id ORDER BY c DESC LIMIT 15""", t=topic["id"]):
            vid = g.node(f"verse:{B.ref_from_ordinal(r['verse_id'])}", "verse", B.display_ref(r["verse_id"]), float(r["c"]), ref=B.ref_from_ordinal(r["verse_id"]))
            g.edge(vid, root, "HAS_THEME", "Theme", float(r["c"]))
        for r in fetch_all(session, f"""SELECT s.id, s.heading, s.summary, s.start_ms, s.page_start, r.id AS rid, r.title, r.type, max(st.confidence) AS c
                                       FROM segment_topics st JOIN resource_segments s ON s.id = st.segment_id JOIN resources r ON r.id = s.resource_id
                                       WHERE st.topic_id = :t AND s.is_active AND {vis} GROUP BY s.id, r.id ORDER BY c DESC LIMIT 12""", t=topic["id"], **params):
            sid = g.node(f"segment:{r['id']}", "segment", r["heading"] or r["title"], float(r["c"]), resource_id=r["rid"], summary=r["summary"], start_ms=r["start_ms"], page=r["page_start"])
            rid = g.node(f"resource:{r['rid']}", "resource", r["title"], float(r["c"]), resource_type=r["type"])
            g.edge(sid, root, "ABOUT", "About", float(r["c"]))
            g.edge(rid, sid, "HAS_SEGMENT", "Has section")
        for r in fetch_all(session, """SELECT t2.canonical_slug, t2.name, count(*) AS n FROM segment_topics a JOIN segment_topics b ON a.segment_id = b.segment_id AND b.topic_id <> a.topic_id
                                       JOIN topics t2 ON t2.id = b.topic_id WHERE a.topic_id = :t GROUP BY t2.id ORDER BY n DESC LIMIT 6""", t=topic["id"]):
            tid = g.node(f"topic:{r['canonical_slug']}", "topic", r["name"], min(0.9, 0.3 + 0.1 * r["n"]), slug=r["canonical_slug"])
            g.edge(root, tid, "CO_OCCURS", "Often discussed together")
    elif root_type == "resource":
        res = fetch_one(session, f"SELECT r.* FROM resources r WHERE r.id = :id AND {visibility_clause(viewer, 'r', discoverable=False)[0]}", id=root_id, **visibility_clause(viewer, "r", discoverable=False)[1])
        if not res:
            raise NotFound("resource not found")
        root = g.node(f"resource:{res['id']}", "resource", res["title"], 1.0, resource_type=res["type"])
        for l in fetch_all(session, """SELECT l.id, l.verse_id, l.end_verse_id, l.relationship_type, l.confidence, l.is_human_verified, l.why_related, l.evidence_text, s.id AS sid, s.ordinal, s.heading, s.start_ms, s.page_start
                                       FROM verse_resource_links l JOIN resource_segments s ON s.id = l.segment_id WHERE l.resource_id = :r AND l.parent_link_id IS NULL
                                       AND l.review_status IN ('published','approved') ORDER BY l.confidence DESC LIMIT 40""", r=res["id"]):
            if not _edge_allowed(l["relationship_type"], l["is_human_verified"], filters):
                continue
            sid = g.node(f"segment:{l['sid']}", "segment", l["heading"] or f"Section {l['ordinal'] + 1}", float(l["confidence"]), resource_id=res["id"], start_ms=l["start_ms"], page=l["page_start"])
            g.edge(root, sid, "HAS_SEGMENT", "Has section")
            ref = B.canonical_range_str(l["verse_id"], l["end_verse_id"])
            vid = g.node(f"verse:{ref}", "verse", B.display_ref(l["verse_id"], l["end_verse_id"]), float(l["confidence"]), ref=ref)
            etype = {"direct_reference": "DIRECTLY_MENTIONS", "scripture_quote": "QUOTES", "contextual_reference": "CONTEXTUALLY_REFERENCES", "ai_related": "RELATED_TO"}[l["relationship_type"]]
            g.edge(sid, vid, etype, etype.replace("_", " ").title(), float(l["confidence"]), relationship_type=l["relationship_type"], human_verified=l["is_human_verified"], why=l["why_related"] or l["evidence_text"], mapping_id=l["id"])
        if not filters.get("direct_only") and not filters.get("human_verified_only"):
            for t in fetch_all(session, """SELECT t.canonical_slug, t.name, count(*) AS n FROM segment_topics st JOIN resource_segments s ON s.id = st.segment_id JOIN topics t ON t.id = st.topic_id
                                           WHERE s.resource_id = :r GROUP BY t.id ORDER BY n DESC LIMIT 8""", r=res["id"]):
                tid = g.node(f"topic:{t['canonical_slug']}", "topic", t["name"], min(0.9, 0.4 + 0.1 * t["n"]), slug=t["canonical_slug"])
                g.edge(root, tid, "ABOUT", "About")
        if res.get("speaker") or res.get("author"):
            name = res.get("speaker") or res.get("author")
            cid = g.node(f"creator:{name.lower()}", "creator", name, 0.4)
            g.edge(root, cid, "AUTHORED_OR_SPOKEN_BY", "Speaker/author")
    elif root_type == "entity":
        ent = next((e for e in load_entities() if e.id == root_id or e.id == f"ent_{root_id}"), None)
        row = fetch_one(session, "SELECT * FROM entities WHERE id = :id OR canonical_key = :id", id=root_id)
        if not ent and not row:
            raise NotFound("entity not found")
        name = ent.name if ent else row["name"]
        etype = ent.type if ent else row["type"]
        eid = ent.id if ent else row["id"]
        root = g.node(f"entity:{eid}", etype, name, 1.0, entity_id=eid, description=ent.description if ent else row.get("description"))
        passages = ent.passages if ent else [B.parse_canonical_range(p) for p in row["passages"] if B.parse_canonical_range(p)]
        for s, e in passages[:6]:
            ref = B.canonical_range_str(s, e if e != s else None)
            vid = g.node(f"verse:{ref}", "verse", B.display_ref(s, e if e != s else None), 0.9, ref=ref)
            g.edge(root, vid, "KEY_PASSAGE", "Key passage", 0.9)
        for r in fetch_all(session, f"""SELECT s.id, s.heading, s.summary, s.start_ms, s.page_start, r.id AS rid, r.title, r.type, se.confidence
                                       FROM segment_entities se JOIN resource_segments s ON s.id = se.segment_id JOIN resources r ON r.id = s.resource_id
                                       WHERE se.entity_id = :e AND s.is_active AND {vis} ORDER BY se.confidence DESC LIMIT 12""", e=eid, **params):
            sid = g.node(f"segment:{r['id']}", "segment", r["heading"] or r["title"], float(r["confidence"]), resource_id=r["rid"], summary=r["summary"], start_ms=r["start_ms"], page=r["page_start"])
            rid = g.node(f"resource:{r['rid']}", "resource", r["title"], float(r["confidence"]), resource_type=r["type"])
            g.edge(sid, root, "MENTIONS", "Mentions", float(r["confidence"]))
            g.edge(rid, sid, "HAS_SEGMENT", "Has section")
    else:
        raise NotFound("unsupported root type")
    data = g.to_dict(root)
    data["list"] = _list_view(data)
    data["filters"] = filters
    return data


def _list_view(data: dict[str, Any]) -> list[dict[str, Any]]:
    """Accessible list alternative to the visual graph, grouped by node type (spec §6.3)."""
    by_id = {n["id"]: n for n in data["nodes"]}
    groups: dict[str, list[dict[str, Any]]] = {}
    for e in data["edges"]:
        other = e["target"] if e["source"] == data["root"] else (e["source"] if e["target"] == data["root"] else None)
        if other is None or other not in by_id:
            continue
        n = by_id[other]
        groups.setdefault(n["type"], []).append({"node": n, "edge": e})
    order = ["segment", "verse", "topic", "person", "event", "place", "resource", "book", "creator"]
    return [{"type": t, "items": sorted(groups[t], key=lambda x: -(x["node"]["score"] or 0))} for t in order if t in groups]

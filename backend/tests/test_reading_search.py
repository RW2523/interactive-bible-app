"""Reading surfaces over shared processed resources: chapter + Verse Intelligence (AC-04), search (AC-10),
resource/segment/clip navigation (AC-11), Scripture Map filters (AC-13), provenance (AC-15), auth, Bible and system APIs."""
from __future__ import annotations

import re
import time

import pytest

from interactive_bible import security

from .support import (
    ADMIN,
    EDITOR,
    MEMBER,
    auth_headers,
    create_resource,
    links_for,
    process_now,
    reset_mutable_state,
    sql,
    sql_exec,
    sql_one,
)

pytestmark = pytest.mark.shared_data

STUDY = """# Study notes

Paul writes in Romans 8:28 that God is at work in every season of life.

# The verse itself

We know that all things work together for good for those who love God, for those who are called according to his purpose.

# Forgiveness

How can I forgive someone who hurt me? Forgiveness is hard, but we forgive because we have been forgiven. Read Ephesians 4:32 together.
"""
PODCAST = "Grace notes on forgiveness: releasing a debt, praying for the person who hurt you, and choosing mercy one day at a time."


@pytest.fixture(scope="module")
def library(_app_client):
    reset_mutable_state()
    study = create_resource(_app_client, auth_headers(EDITOR), type="document", category="study", title="Romans 8 small group study", body_text=STUDY, author="Marcus Bell")
    podcast = create_resource(_app_client, auth_headers(EDITOR), type="native", category="podcast", title="Grace Notes forgiveness", body_text=PODCAST)
    runs = {key: process_now(res["id"]) for key, res in (("study", study), ("podcast", podcast))}
    assert all(r["status"] == "succeeded" for r in runs.values())
    segments = sql("SELECT id, ordinal, heading FROM resource_segments WHERE resource_id = :r ORDER BY ordinal", r=study["id"])
    yield {"study": study["id"], "podcast": podcast["id"], "runs": runs, "segments": segments}
    reset_mutable_state()


# ----------------------------------------------------------------------------- AC-04
def test_ac04_verse_intelligence_is_independent_of_chapter_state(library, client):
    """AC-04 (API side) /v1/verses/ROM.8.28/intelligence works on its own and returns verse, counts, top_resources, themes, related_verses, map_preview and provenance."""
    body = client.get("/v1/verses/ROM.8.28/intelligence").json()  # no chapter request made first
    assert {"verse", "counts", "top_resources", "themes", "related_verses", "map_preview", "provenance"} <= set(body)
    verse = body["verse"]
    assert verse["ref"] == "ROM.8.28" and verse["display_ref"] == "Romans 8:28" and verse["translation"] == "web"
    assert verse["text"].startswith("We know that all things work together for good")
    assert set(verse["verses"][0]["translations"]) == {"web", "kjv", "asv"}
    assert body["counts"]["study"] == 2 and body["counts"]["video"] == 0 and body["counts"]["related_verses"] >= 1
    assert {c["segment_id"] for c in body["top_resources"]} == {library["segments"][0]["id"], library["segments"][1]["id"]}
    assert body["top_resources"][0]["relationship"]["type"] == "direct_reference"  # direct mention outranks the quote
    assert body["related_verses"] and all({"ref", "why", "why_status", "label"} <= set(r) for r in body["related_verses"])
    assert body["map_preview"]["nodes"] >= 1 + len(body["top_resources"])
    prov = body["provenance"]
    assert prov["cache"] == "miss" and prov["pipeline_versions"] == ["scripture-intelligence-1.0"] and prov["last_updated"]
    assert "not theological truth" in prov["confidence_note"]
    assert body["book_context"] == {"code": "ROM", "name": "Romans", "testament": "New Testament", "genre": "Letter", "attribution": "Paul"}
    assert body["ai_available"] is False


def test_ac04_chapter_endpoint_with_indicators(library, client):
    """AC-04 (API side) /v1/bible/chapters/ROM/8 returns the chapter with mapped-resource indicators and navigation."""
    body = client.get("/v1/bible/chapters/ROM/8").json()
    assert body["book"]["code"] == "ROM" and body["chapter"] == 8 and len(body["verses"]) == 39
    by_number = {v["number"]: v for v in body["verses"]}
    assert by_number[28]["ref"] == "ROM.8.28" and by_number[28]["indicators"] == {"watch": 0, "listen": 0, "study": 2, "total": 2, "explicit": True}
    assert by_number[27]["indicators"] is None
    assert body["prev"] == {"book": "ROM", "chapter": 7} and body["next"] == {"book": "ROM", "chapter": 9}
    assert client.get("/v1/bible/chapters/romans/8").json()["book"]["code"] == "ROM"
    kjv = client.get("/v1/bible/chapters/ROM/8", params={"translation": "kjv"}).json()
    assert kjv["translation"] == "kjv" and "all things work together for good" in {v["number"]: v for v in kjv["verses"]}[28]["text"]
    assert client.get("/v1/bible/chapters/ROM/17").status_code == 404
    assert client.get("/v1/bible/chapters/XYZ/1").status_code == 404
    edges = client.get("/v1/bible/chapters/GEN/1").json()
    assert edges["prev"] is None and edges["next"] == {"book": "GEN", "chapter": 2}
    assert client.get("/v1/bible/chapters/REV/22").json()["next"] is None
    assert client.get("/v1/bible/chapters/MAL/4").json()["next"] == {"book": "MAT", "chapter": 1}


def test_ac04_intelligence_reference_formats_ranges_etag_and_errors(library, client):
    """AC-04 Verse Intelligence accepts human and canonical reference formats and ranges, supports ETag revalidation and 404s unknown references."""
    for ref in ("Romans 8:28", "rom_8_28", "ROM.8.28", "Rom 8:28"):
        assert client.get(f"/v1/verses/{ref}/intelligence").json()["verse"]["ref"] == "ROM.8.28"
    ranged = client.get("/v1/verses/ROM.8.28-ROM.8.30/intelligence").json()
    assert ranged["verse"]["ref"] == "ROM.8.28-ROM.8.30" and len(ranged["verse"]["verses"]) == 3 and ranged["counts"]["study"] == 2
    resp = client.get("/v1/verses/ROM.8.28/intelligence")
    etag = resp.headers["etag"]
    assert client.get("/v1/verses/ROM.8.28/intelligence", headers={"If-None-Match": etag}).status_code == 304
    assert client.get("/v1/verses/Hezekiah 9:9/intelligence").status_code == 404
    assert client.get("/v1/verses/ROM.99.1/intelligence").status_code == 404
    assert sql_one("SELECT count(*) AS n FROM analytics_events WHERE type = 'verse_intelligence_view'")["n"] >= 5


def test_verse_resources_endpoint_filters_and_sorts(library, client):
    all_cards = client.get("/v1/verses/ROM.8.28/resources").json()
    assert all_cards["total"] == 2
    quotes = client.get("/v1/verses/ROM.8.28/resources", params={"relationship": "scripture_quote"}).json()
    assert quotes["total"] == 1 and quotes["items"][0]["relationship"]["detected_type"] == "scripture_quote"
    assert client.get("/v1/verses/ROM.8.28/resources", params={"kind": "watch"}).json()["total"] == 0
    assert client.get("/v1/verses/ROM.8.28/resources", params={"human_verified": "true"}).json()["total"] == 0
    assert client.get("/v1/verses/ROM.8.28/resources", params={"resource_type": "study"}).json()["total"] == 2
    by_conf = client.get("/v1/verses/ROM.8.28/resources", params={"sort": "confidence"}).json()["items"]
    assert [c["relationship"]["confidence"] for c in by_conf] == sorted([c["relationship"]["confidence"] for c in by_conf], reverse=True)
    assert client.get("/v1/verses/ROM.8.28/resources", params={"kind": "invalid"}).status_code == 422


# ----------------------------------------------------------------------------- AC-10
def test_ac10_search_explicit_reference_returns_verses_and_segments(library, client):
    """AC-10 Search handles an explicit verse query ("Romans 8:28") and returns both verses and resource segments."""
    body = client.post("/v1/search/scripture", json={"query": "Romans 8:28"}).json()
    assert body["parsed"]["explicit_refs"] == ["ROM.8.28"] and body["scope"] == "both"
    assert body["verses"][0]["ref"] == "ROM.8.28" and "exact_reference" in body["verses"][0]["match_types"]
    assert "Explained in library resources" in body["verses"][0]["reasons"]
    segment_ids = [s["segment_id"] for s in body["segments"]]
    assert segment_ids[:2] == [library["segments"][0]["id"], library["segments"][1]["id"]]
    assert body["segments"][0]["reasons"][0] == "Direct mention of Romans 8:28"
    assert "matched the reference Romans 8:28" in body["explanation"] and body["reranked"] is False and body["semantic"] is False
    log = sql("SELECT query, result_count FROM search_logs WHERE query = 'Romans 8:28'")
    assert log and log[0]["result_count"] >= len(body["verses"]) + len(body["segments"])  # logged before truncation to `limit`


def test_ac10_search_natural_language_topic_query(library, client):
    """AC-10 Search handles a natural-language topic query and returns both verses and segments."""
    body = client.post("/v1/search/scripture", json={"query": "how can I forgive someone who hurt me"}).json()
    assert "Forgiveness" in body["parsed"]["topics"] and body["parsed"]["explicit_refs"] == []
    assert body["verses"], "keyword retrieval should find verses about forgiving"
    assert any("forgiv" in v["text"].lower() for v in body["verses"][:5])
    titles = {s["resource"]["title"] for s in body["segments"]}
    assert {"Romans 8 small group study", "Grace Notes forgiveness"} <= titles
    forgiveness_segment = next(s for s in body["segments"] if s["segment_id"] == library["segments"][2]["id"])
    assert "Keyword match" in forgiveness_segment["reasons"] or any(r.startswith("About") for r in forgiveness_segment["reasons"])


def test_ac10_search_scope_type_filters_and_validation(library, client):
    """AC-10 Search scope and resource-type filters restrict verses/segments; input is validated."""
    bible_only = client.post("/v1/search/scripture", json={"query": "Romans 8:28", "scope": "bible"}).json()
    assert bible_only["verses"] and bible_only["segments"] == []
    resources_only = client.post("/v1/search/scripture", json={"query": "forgiveness", "scope": "resources"}).json()
    assert resources_only["verses"] == [] and resources_only["segments"]
    typed = client.post("/v1/search/scripture", json={"query": "podcasts about forgiveness"}).json()
    assert typed["parsed"]["resource_types"] == ["audio", "podcast"] and typed["scope"] == "resources"
    assert {s["resource"]["category"] for s in typed["segments"]} == {"podcast"}
    ranged = client.post("/v1/search/scripture", json={"query": "Romans 8:28-30", "limit": 3}).json()
    assert [v["ref"] for v in ranged["verses"]] == ["ROM.8.28", "ROM.8.29", "ROM.8.30"]
    assert client.post("/v1/search/scripture", json={"query": ""}).status_code == 422
    assert client.post("/v1/search/scripture", json={"query": "x" * 501}).status_code == 422


def test_ac10_search_with_ai_parses_and_reranks(library, client, fake_llm):
    """AC-10 With AI, search is parsed by P-10, embedded and re-ranked by P-11 with grounded reasons."""
    body = client.post("/v1/search/scripture", json={"query": "verses about forgiving people who hurt us"}).json()
    assert body["parsed"]["parser"] == "P-10" and body["reranked"] is True
    assert all("rerank_score" in item for item in body["verses"][:12] + body["segments"][:12])
    assert body["verses"][0]["reasons"][0] == "Directly addresses the query"
    prompts = {r["prompt_id"] for r in sql("SELECT DISTINCT prompt_id FROM llm_calls")}
    assert {"P-10", "P-11", "EMBED"} <= prompts
    assert body["semantic"] is True  # a query embedding was computed (no verse embeddings exist in the test corpus)
    hallucinated = client.post("/v1/search/scripture", json={"query": "forgiveness and grace notes", "no_rerank": True}).json()
    assert hallucinated["reranked"] is False


# ----------------------------------------------------------------------------- AC-11
def test_ac11_resource_detail_segments_and_verse_links_resolve_to_clips(library, client):
    """AC-11 Resource detail, /segments and /verse-links list every mapped verse with segment ids that /v1/clips/{segment_id} resolves."""
    rid = library["study"]
    detail = client.get(f"/v1/resources/{rid}").json()
    assert detail["title"] == "Romans 8 small group study" and detail["status"] == "processed" and detail["playback"]["mode"] == "text"
    assert detail["can_edit"] is False and "owner_id" not in detail  # anonymous view
    assert any(t["slug"] == "forgiveness" for t in detail["topics"])

    segments = client.get(f"/v1/resources/{rid}/segments").json()["segments"]
    assert [s["heading"] for s in segments] == ["Study notes", "The verse itself", "Forgiveness"]
    assert all("transcript_raw" not in s and "review_status" not in m for s in segments for m in s["mappings"])
    mapped_from_segments = {(m["verse_ref"], s["id"]) for s in segments for m in s["mappings"]}

    links = client.get(f"/v1/resources/{rid}/verse-links").json()
    assert {(l["verse_ref"], l["segment_id"]) for l in links["links"]} == mapped_from_segments
    assert {(v["ref"], v["display"], v["segments"]) for v in links["verses"]} == {("ROM.8.28", "Romans 8:28", 2), ("EPH.4.32", "Ephesians 4:32", 1)}
    db_refs = {(l["canonical_ref"], l["segment_id"]) for l in links_for(rid) if l["review_status"] in ("published", "approved")}
    assert mapped_from_segments == db_refs

    for verse_ref, segment_id in mapped_from_segments:
        clip = client.get(f"/v1/clips/{segment_id}").json()
        assert clip["segment_id"] == segment_id and clip["resource"]["id"] == rid
        assert verse_ref in {v["ref"] for v in clip["verses"]}
        assert clip["clip"]["start_ms"] is None and clip["can_export"] is False and clip["export_blocked_reason"] == "Not a media resource."
    middle = client.get(f"/v1/clips/{segments[1]['id']}").json()["navigation"]
    assert middle == {"previous_segment": segments[0]["id"], "next_segment": segments[2]["id"]}
    assert client.get("/v1/clips/seg_does_not_exist").status_code == 404

    owner_view = client.get(f"/v1/resources/{rid}/segments", headers=auth_headers(EDITOR)).json()["segments"]
    assert all("transcript_raw" in s for s in owner_view) and all("review_status" in m for s in owner_view for m in s["mappings"])


# ----------------------------------------------------------------------------- AC-13
def _edges(client, params, headers=None):
    graph = client.get("/v1/scripture-map", params=params, headers=headers or {}).json()
    return graph, [(e["type"], e["source"], e["target"]) for e in graph["edges"]]


def test_ac13_scripture_map_filters_restrict_edges(library, client):
    """AC-13 Scripture map direct_only / explicit_only / human_verified_only filters restrict the edges returned."""
    root = "verse:ROM.8.28"
    graph, edges = _edges(client, {"root_type": "verse", "root_id": "ROM.8.28"})
    types = {t for t, _, _ in edges}
    assert {"DIRECTLY_MENTIONS", "QUOTES", "HAS_SEGMENT", "IN_BOOK", "RELATED_TO"} <= types
    assert graph["root"] == root and graph["nodes"][0]["id"] == root and graph["truncated"] is False

    _, direct = _edges(client, {"root_type": "verse", "root_id": "ROM.8.28", "direct_only": "true"})
    mapping_edges = [e for e in direct if e[2] == root and e[0] not in ("IN_BOOK",)]
    assert {e[0] for e in mapping_edges} == {"DIRECTLY_MENTIONS"}
    assert not any(t in ("QUOTES", "RELATED_TO", "HAS_THEME", "INVOLVES") for t, _, _ in direct)

    _, explicit = _edges(client, {"root_type": "verse", "root_id": "ROM.8.28", "explicit_only": "true"})
    assert {t for t, _, target in explicit if target == root} == {"DIRECTLY_MENTIONS", "QUOTES"}

    _, human = _edges(client, {"root_type": "verse", "root_id": "ROM.8.28", "human_verified_only": "true"})
    assert not any(t in ("DIRECTLY_MENTIONS", "QUOTES") for t, _, _ in human)
    quote = next(l for l in links_for(library["study"]) if l["relationship_type"] == "scripture_quote")
    assert client.post(f"/v1/admin/mappings/{quote['id']}/approve", headers=auth_headers(EDITOR)).status_code == 200
    try:
        _, human = _edges(client, {"root_type": "verse", "root_id": "ROM.8.28", "human_verified_only": "true"})
        assert [t for t, _, target in human if target == root] == ["QUOTES"]
    finally:
        sql_exec("UPDATE verse_resource_links SET review_status = 'published', is_human_verified = false WHERE id = :id OR parent_link_id = :id", id=quote["id"])
        sql_exec("DELETE FROM review_actions WHERE object_id = :id", id=quote["id"])


def test_ac13_resource_root_map_filters_and_list_view(library, client):
    """AC-13 Map filters also restrict resource-rooted maps; topic/entity roots and the accessible list view work."""
    graph, edges = _edges(client, {"root_type": "resource", "root_id": library["study"]})
    assert {"DIRECTLY_MENTIONS", "QUOTES", "HAS_SEGMENT", "AUTHORED_OR_SPOKEN_BY"} <= {t for t, _, _ in edges}
    assert {g["type"] for g in graph["list"]} >= {"segment", "creator"}
    _, direct = _edges(client, {"root_type": "resource", "root_id": library["study"], "direct_only": "true"})
    assert "QUOTES" not in {t for t, _, _ in direct} and "DIRECTLY_MENTIONS" in {t for t, _, _ in direct}
    assert "ABOUT" not in {t for t, _, _ in direct}
    topic_graph, topic_edges = _edges(client, {"root_type": "topic", "root_id": "forgiveness"})
    assert topic_graph["root"] == "topic:forgiveness" and ("ABOUT", f"segment:{library['segments'][2]['id']}", "topic:forgiveness") in topic_edges
    entity_graph, entity_edges = _edges(client, {"root_type": "entity", "root_id": "ent_prodigal-son"})
    assert ("KEY_PASSAGE", "entity:ent_prodigal-son", "verse:LUK.15.11-LUK.15.32") in entity_edges
    assert client.get("/v1/scripture-map", params={"root_type": "topic", "root_id": "no-such-topic"}).status_code == 404
    assert client.get("/v1/scripture-map", params={"root_type": "galaxy", "root_id": "x"}).status_code == 422
    deep = client.get("/v1/scripture-map", params={"root_type": "verse", "root_id": "ROM.8.28", "depth": 2}).json()
    assert len(deep["nodes"]) <= 60


# ----------------------------------------------------------------------------- AC-15
def test_ac15_every_mapping_has_provenance_and_evidence(library):
    """AC-15 Every stored mapping carries provenance (source, pipeline_version, run_id, detectors) and evidence_text."""
    all_links = links_for(library["study"], parents_only=False) + links_for(library["podcast"], parents_only=False)
    assert all_links
    runs = {library["runs"]["study"]["run_id"], library["runs"]["podcast"]["run_id"]}
    for link in all_links:
        prov = link["provenance"]
        assert prov["source"] == "pipeline"
        assert prov["pipeline_version"] == link["pipeline_version"] == "scripture-intelligence-1.0"
        assert prov["run_id"] in runs and prov["run_id"] == link["processing_run_id"]
        assert prov["detectors"] and isinstance(prov["detectors"], list)
        assert prov["degraded"] is True and prov["ai_calls"] == []  # no AI configured in this module
        assert link["evidence_text"] and link["evidence_offsets"]


def test_processing_run_records_versions_stages_and_metrics(library, client):
    run_id = library["runs"]["study"]["run_id"]
    run = client.get(f"/v1/admin/runs/{run_id}", headers=auth_headers(EDITOR)).json()
    assert run["status"] == "succeeded" and run["degraded"] is True and run["pipeline_version"] == "scripture-intelligence-1.0"
    assert re.fullmatch(r"\d+\.\d+\.\d+\+[0-9a-f]{10}", run["prompt_versions"]["P-04"]) and run["model_versions"]["ai_enabled"] is False  # semver + content hash
    assert [s["id"] for s in run["stages"]][0] == "ING-01" and all(s["status"] in ("completed", "skipped") for s in run["stages"])
    assert run["metrics"]["segments"] == 3 and run["metrics"]["mappings_by_type"] == {"direct_reference": 2, "scripture_quote": 1}
    assert run["llm_calls"] == []
    listed = client.get("/v1/admin/runs", params={"resource_id": library["study"]}, headers=auth_headers(EDITOR)).json()
    assert [r["id"] for r in listed] == [run_id]


# ----------------------------------------------------------------------------- auth / bible / system
def test_login_endpoint_me_and_logout(library, client):
    bad = client.post("/v1/auth/login", json={"email": MEMBER, "password": "wrong"})
    assert bad.status_code == 401
    ok = client.post("/v1/auth/login", json={"email": MEMBER.upper(), "password": "bible-demo"})
    assert ok.status_code == 200 and ok.json()["user"]["role"] == "member" and "ibible_token" in ok.cookies
    me = client.get("/v1/auth/me", headers={"Authorization": f"Bearer {ok.json()['token']}"}).json()
    assert me["authenticated"] is True and me["email"] == MEMBER and me["organization_ids"] == ["org_grace"]
    assert client.get("/v1/auth/me").json()["authenticated"] is True  # cookie session
    client.post("/v1/auth/logout")
    client.cookies.clear()
    assert client.get("/v1/auth/me").json()["authenticated"] is False


def test_tampered_or_expired_tokens_are_anonymous(library, client):
    token = auth_headers(ADMIN)["Authorization"].split()[1]
    body, sig = token.split(".")
    assert client.get("/v1/auth/me", headers={"Authorization": f"Bearer {body}.{sig[:-2]}xx"}).json()["authenticated"] is False
    expired = security.sign({"sub": "usr_admin", "role": "admin", "exp": int(time.time()) - 10, "typ": "session"})
    assert client.get("/v1/auth/me", headers={"Authorization": f"Bearer {expired}"}).json()["authenticated"] is False
    media_as_session = security.media_token("res_x")
    assert client.get("/v1/auth/me", headers={"Authorization": f"Bearer {media_as_session}"}).json()["authenticated"] is False
    forged_role = security.sign({"sub": "usr_member", "role": "admin", "exp": int(time.time()) + 60, "typ": "session"})
    assert client.get("/v1/auth/me", headers={"Authorization": f"Bearer {forged_role}"}).json()["role"] == "member"  # role comes from the DB
    assert security.verify_password("bible-demo", security.hash_password("bible-demo")) and not security.verify_password("x", "garbage")


def test_bible_reference_endpoints(library, client):
    translations = client.get("/v1/bible/translations").json()
    assert [t["id"] for t in translations] == ["web", "asv", "kjv"] and translations[0]["is_default"] is True
    assert all(t["verse_count"] > 31000 and t["license"] for t in translations)
    books = client.get("/v1/bible/books").json()
    assert len(books) == 66 and books[0]["code"] == "GEN" and books[-1]["chapters"] == 22
    parsed = client.get("/v1/bible/parse", params={"q": "rom 8:28-30"}).json()
    assert parsed["canonical"] == "ROM.8.28-ROM.8.30" and parsed["references"][0]["display"] == "Romans 8:28-30"
    assert client.get("/v1/bible/parse", params={"q": "hello"}).json()["canonical"] is None
    assert len(client.get("/v1/topics").json()) == 72 and len(client.get("/v1/entities").json()) == 147


def test_system_status_health_and_metrics(library, client):
    assert client.get("/healthz").json() == {"ok": True}
    public = client.get("/v1/system/status").json()
    assert set(public) == {"corpus", "ai", "embeddings"} and public["ai"] == {"configured": False}
    assert public["corpus"]["verses"] == 31105 and public["corpus"]["cross_references"] > 40000
    staff = client.get("/v1/system/status", headers=auth_headers(EDITOR)).json()
    assert staff["database"]["migrations"][0] == "001_init.sql" and "002_sermon_studio_and_explore.sql" in staff["database"]["migrations"] and "P-12" in staff["ai"]["prompt_versions"]
    assert staff["storage"]["disk_total_bytes"] > 0 and staff["storage"]["files"] >= 0 and {"image", "speech"} <= set(staff["ai"]["models"])
    assert staff["policy"]["feedback_hide_threshold"] == 3
    prom = client.get("/metrics").text
    assert 'ibible_mappings{type="direct_reference",status="published"}' in prom and "ibible_llm_calls_today" in prom
    dashboard = client.get("/v1/admin/metrics", headers=auth_headers(ADMIN)).json()
    assert dashboard["processing"]["runs"][0]["status"] == "succeeded" and dashboard["review"]["queue_open"] >= 0
    doctor = client.post("/v1/admin/system/check-gemini", headers=auth_headers(ADMIN)).json()
    assert doctor["configured"] is False and doctor["ok"] is False


def test_ask_requires_ai_and_drops_ungrounded_citations(library, client, no_llm):
    resp = client.post("/v1/ask", json={"ref": "ROM.8.28", "question": "What does this promise mean?"})
    assert resp.status_code == 403 and "Gemini" in resp.json()["detail"]


def test_ask_with_ai_keeps_only_grounded_citations(library, client, fake_llm):
    segment_id = library["segments"][0]["id"]
    fake_llm.on("P-14", {"answer": "God works for good.", "citations": [{"kind": "verse", "id": "ROM.8.28"}, {"kind": "verse", "id": "REV.22.21"},
                                                                          {"kind": "segment", "id": segment_id}, {"kind": "segment", "id": "seg_made_up"}],
                         "interpretive_note": None, "confidence": 0.8})
    body = client.post("/v1/ask", json={"ref": "ROM.8.28", "question": "What does this promise mean?"}, headers=auth_headers(MEMBER)).json()
    assert [c["id"] for c in body["citations"]] == ["ROM.8.28", segment_id]
    assert sorted(body["ungrounded_citations_removed"]) == ["REV.22.21", "seg_made_up"]
    prompt = fake_llm.calls_for("P-14")[0]
    assert segment_id in prompt.section("RESOURCE_EXCERPTS") and "ROM.8.28" in prompt.section("VERSE_TEXTS")


def test_search_with_unknown_translation_falls_back_to_default(library, client):
    body = client.post("/v1/search/scripture", json={"query": "Romans 8:28", "translation": "xyz"}).json()
    assert body["verses"][0]["text"].startswith("We know that all things work together")

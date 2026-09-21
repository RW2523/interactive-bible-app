"""AC-08 when visibility changes after processing: derived data (pipeline verse relationships, aggregated themes,
caches) must follow the resource's current visibility."""
from __future__ import annotations

import pytest

from interactive_bible.bible import books as B

from .fakes import FakeCall
from .support import MEMBER, create_resource, insert_fake_verse_embeddings, link_by_ref, process_now, sql

TEXT = ("Romans 8:28 is our anchor this week. Think about Joseph: his brothers sold him as a slave, "
        "yet what they intended for harm God turned into good. Grief and hope sat side by side in his story.")
WHY = "Joseph's story shows God bringing good out of harm."


VECTOR_SUPPORTED = [B.ordinal("GEN", 50, 20), B.ordinal("PSA", 23, 4), B.ordinal("ISA", 41, 10)]


def _processed_public_resource(client, login, fake_llm) -> tuple[str, str]:
    chosen: dict[str, str] = {}
    insert_fake_verse_embeddings(VECTOR_SUPPORTED)  # retrieval support keeps the AI match in the visible (>= 0.90) band
    supported = {B.ref_from_ordinal(v) for v in VECTOR_SUPPORTED}

    def mapper(call: FakeCall):
        cand = next(c for c in call.json_line("CANDIDATES") if c["verse"] in supported)
        chosen["verse"] = cand["verse"]
        return {"accepted": [{"verse": cand["verse"], "relationship": "narrative_parallel", "evidence": "what they intended for harm God turned into good",
                              "why_related": WHY, "confidence": 0.95}], "rejected": []}

    fake_llm.on("P-04", mapper)
    res = create_resource(client, login(MEMBER), type="native", title="Joseph and Romans 8", body_text=TEXT)
    assert process_now(res["id"])["status"] == "succeeded"
    assert link_by_ref(res["id"], chosen["verse"])["review_status"] == "published"
    return res["id"], chosen["verse"]


def _pipeline_related(client, verse: str, headers=None) -> list[dict]:
    return [r for r in client.get("/v1/verses/ROM.8.28/related?limit=60", headers=headers or {}).json() if "pipeline" in r["sources"] and r["ref"] == verse]


def test_pipeline_relationship_from_public_resource_is_shown(client, login, fake_llm):
    rid, verse = _processed_public_resource(client, login, fake_llm)
    rows = sql("SELECT relationship_type, explanation, evidence FROM verse_relationships WHERE source = 'pipeline'")
    assert len(rows) == 1 and rows[0]["relationship_type"] == "narrative_parallel" and rows[0]["evidence"]["resource_id"] == rid
    (item,) = _pipeline_related(client, verse)
    assert item["why"] == WHY and item["is_ai"] is True


def test_deleting_a_resource_removes_its_pipeline_relationships(client, login, fake_llm):
    rid, verse = _processed_public_resource(client, login, fake_llm)
    assert client.delete(f"/v1/resources/{rid}", headers=login(MEMBER)).status_code == 200
    assert sql("SELECT id FROM verse_relationships WHERE source = 'pipeline'") == []
    assert _pipeline_related(client, verse) == []


def test_visibility_change_invalidates_intelligence_cache(client, login, fake_llm):
    rid, _verse = _processed_public_resource(client, login, fake_llm)
    before = client.get("/v1/verses/ROM.8.28/intelligence").json()
    assert rid in {c["resource"]["id"] for c in before["top_resources"]}
    assert client.patch(f"/v1/resources/{rid}", json={"visibility": "private"}, headers=login(MEMBER)).status_code == 200
    after = client.get("/v1/verses/ROM.8.28/intelligence").json()
    assert after["provenance"]["cache"] == "miss"
    assert rid not in {c["resource"]["id"] for c in after["top_resources"]}
    assert rid in {c["resource"]["id"] for c in client.get("/v1/verses/ROM.8.28/intelligence", headers=login(MEMBER)).json()["top_resources"]}


def test_ac08_pipeline_relationships_disappear_when_resource_becomes_private(client, login, fake_llm):
    """AC-08 Related-verse relationships derived from a resource disappear for everyone else when it becomes private."""
    rid, verse = _processed_public_resource(client, login, fake_llm)
    assert _pipeline_related(client, verse)
    assert client.patch(f"/v1/resources/{rid}", json={"visibility": "private"}, headers=login(MEMBER)).status_code == 200
    assert _pipeline_related(client, verse) == []


def test_ac08_aggregated_themes_disappear_when_resource_becomes_private(client, login, fake_llm):
    """AC-08 Themes aggregated from a resource disappear from anonymous Verse Intelligence when it becomes private."""
    rid, _verse = _processed_public_resource(client, login, fake_llm)
    themes = client.get("/v1/verses/ROM.8.28/intelligence").json()["themes"]
    assert any("segment_aggregation" in t["sources"] for t in themes)  # tagged by P-06 on the (then public) resource
    assert client.patch(f"/v1/resources/{rid}", json={"visibility": "private"}, headers=login(MEMBER)).status_code == 200
    themes = client.get("/v1/verses/ROM.8.28/intelligence").json()["themes"]
    assert not any("segment_aggregation" in t["sources"] for t in themes)  # curated key-verse themes may remain


def test_resource_topics_never_rewrite_the_curated_topic_index(client, login, fake_llm):
    """Aggregating a resource's segment topics must not mutate curated key-verse topics (they could never be re-derived)."""
    curated = "SELECT confidence, provenance->>'source' AS source FROM verse_topics WHERE verse_id = 45008028 AND topic_id = 'topic_providence'"
    assert sql(curated) == [{"confidence": pytest.approx(0.85), "source": "curated_topic_index"}]
    fake_llm.on("P-06", {"topics": [{"name": "Providence & Sovereignty", "confidence": 0.99}]})
    rid, _verse = _processed_public_resource(client, login, fake_llm)
    link = link_by_ref(rid, "ROM.8.28")
    assert sql("SELECT topic_id FROM segment_topics WHERE segment_id = :s AND topic_id = 'topic_providence'", s=link["segment_id"])  # precondition
    assert sql(curated) == [{"confidence": pytest.approx(0.85), "source": "curated_topic_index"}]
    assert client.patch(f"/v1/resources/{rid}", json={"visibility": "private"}, headers=login(MEMBER)).status_code == 200
    assert sql(curated) == [{"confidence": pytest.approx(0.85), "source": "curated_topic_index"}]

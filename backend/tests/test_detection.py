"""Detection acceptance criteria on real processed resources: quotes (AC-02), weak keyword overlap (AC-03),
labels (AC-06) and grounded AI relationships / explanations (AC-07)."""
from __future__ import annotations

import re

import pytest

from interactive_bible.bible import books as B
from interactive_bible.pipeline.detectors import grounded_span

from .fakes import FakeCall, best_sentence
from .support import EDITOR, VISIBLE, create_resource, insert_fake_verse_embeddings, link_by_ref, links_for, process_now, refs, sql, sql_one


def native(client, login, text: str, **fields) -> str:
    res = create_resource(client, login(EDITOR), type="native", title=fields.pop("title", "Detection test"), body_text=text, **fields)
    result = process_now(res["id"])
    assert result["status"] == "succeeded"
    return res["id"]


def visible_links(resource_id: str) -> list[dict]:
    return [l for l in links_for(resource_id, parents_only=False) if l["review_status"] in VISIBLE]


# ----------------------------------------------------------------------------- AC-02
def test_ac02_exact_quotation_without_reference_is_a_scripture_quote(client, login):
    """AC-02 A close quotation without a reference becomes a scripture_quote (deterministic path, exact WEB and KJV wording)."""
    rid = native(client, login, "# Resting in God\n\nJesus once gave his followers a word for the restless mind: "
                                 "Therefore don’t be anxious for tomorrow, for tomorrow will be anxious for itself. Each day’s own evil is sufficient.\n\n"
                                 "Two lines hang over my desk: Thy word is a lamp unto my feet, and a light unto my path.")
    quote = link_by_ref(rid, "MAT.6.34")
    assert quote["relationship_type"] == "scripture_quote" and quote["relationship_subtype"] == "lexical_match"
    assert quote["review_status"] == "published" and quote["needs_review"] is False and quote["confidence"] >= 0.9
    assert "anxious for tomorrow" in quote["evidence_text"]
    assert quote["provenance"]["detectors"] == ["quote_index"] and quote["provenance"]["signals"]["scripture_quote"]["translation"] == "web"
    kjv = link_by_ref(rid, "PSA.119.105")
    assert kjv["relationship_type"] == "scripture_quote" and kjv["provenance"]["signals"]["scripture_quote"]["translation"] in ("kjv", "asv")
    assert refs(links_for(rid)) == {"MAT.6.34", "PSA.119.105"}  # nothing else was invented
    assert all(l["relationship_type"] != "direct_reference" for l in links_for(rid))


def test_ac02_short_verse_quote_is_detected_but_flagged_for_review(client, login):
    """AC-02 A very short verse quoted without reference ("Jesus wept") is a scripture_quote that stays flagged for review."""
    rid = native(client, login, "At the graveside we simply remembered that Jesus wept.")
    link = link_by_ref(rid, "JHN.11.35")
    assert link["relationship_type"] == "scripture_quote" and link["relationship_subtype"] == "lexical_match"
    assert link["review_status"] == "published" and link["needs_review"] is True and "unverified_short_quote" in link["review_reasons"]


CLOSE_QUOTE = "Pastor Ruth reminded us that all things work for the good of those who love God and are called by him."
CLOSE_EVIDENCE = "all things work for the good of those who love God and are called by him"


def test_ac02_close_quote_needs_ai_verification(client, login, fake_llm):
    """AC-02 AI path: a close (non-verbatim) quotation is confirmed by P-03 (close_quote) and stored as a scripture_quote."""
    def verifier(call: FakeCall):
        segment = call.section("SEGMENT")
        return {"matches": [
            {"verse": c["verse"], "classification": "close_quote" if c["verse"] == "ROM.8.28" else "unrelated",
             "evidence": CLOSE_EVIDENCE if c["verse"] == "ROM.8.28" else "", "confidence": 0.9}
            for c in call.json_line("CANDIDATES")
        ]} if CLOSE_EVIDENCE in segment else {"matches": []}

    fake_llm.on("P-03", verifier)
    rid = native(client, login, CLOSE_QUOTE)
    link = link_by_ref(rid, "ROM.8.28")
    assert link is not None, links_for(rid)
    assert link["relationship_type"] == "scripture_quote" and link["relationship_subtype"] == "close_quote"
    # little verbatim overlap (containment < 0.3): published but queued for review, shown as a possible quote until verified
    assert link["confidence"] == pytest.approx(0.89) and link["review_status"] == "published" and link["needs_review"] is True
    assert link["evidence_text"] == CLOSE_EVIDENCE
    assert sorted(link["provenance"]["detectors"]) == ["P-03", "quote_index"]
    p03 = fake_llm.calls_for("P-03")
    assert len(p03) == 1 and any(c["verse"] == "ROM.8.28" for c in p03[0].json_line("CANDIDATES"))
    assert {"P-03", "P-05", "P-12"} <= set(r["prompt_id"] for r in sql("SELECT DISTINCT prompt_id FROM llm_calls WHERE resource_id = :r", r=rid))


def test_ac02_close_quote_is_not_accepted_without_ai(client, login):
    """AC-02 contrast: the same close quotation has too little lexical evidence for the deterministic path."""
    rid = native(client, login, CLOSE_QUOTE)
    assert links_for(rid) == []


# ----------------------------------------------------------------------------- AC-03
GENERIC = ("Some people have more faith in the stock market than in anything else. "
           "Honestly, my patience with the printer ran out long before my love for coffee did.")


def test_ac03_generic_keyword_overlap_exposes_no_verses_deterministic(client, login):
    """AC-03 A generic discussion sharing one keyword with Scripture exposes no unrelated verses (deterministic)."""
    rid = native(client, login, GENERIC)
    assert visible_links(rid) == []
    assert client.get(f"/v1/resources/{rid}/verse-links").json()["total"] == 0
    search = client.post("/v1/search/scripture", json={"query": "faith", "scope": "resources"}).json()
    assert all(s["resource"]["id"] != rid or s["verse_ref"] is None for s in search["segments"])


@pytest.mark.parametrize("p04_confidence", [0.55, 0.91])
def test_ac03_weak_ai_candidates_are_not_user_visible(client, login, fake_llm, p04_confidence):
    """AC-03 With AI, weak semantic candidates proposed by P-04 and rejected by P-12 never become user-visible."""
    proposed: dict[str, str] = {}

    def mapper(call: FakeCall):
        first = call.json_line("CANDIDATES")[0]
        proposed["verse"] = first["verse"]
        return {"accepted": [{"verse": first["verse"], "relationship": "thematic", "evidence": "faith in the stock market",
                              "why_related": "Both mention faith.", "confidence": p04_confidence}], "rejected": []}

    def auditor(call: FakeCall):
        return {"approved": [], "needs_review": [], "rejected": [{"verse": m["verse"], "reason": "only shares the word faith"} for m in call.json_line("PROPOSED_MAPPINGS")]}

    fake_llm.on("P-04", mapper).on("P-12", auditor)
    rid = native(client, login, GENERIC)
    assert proposed, "P-04 was never asked"
    assert fake_llm.calls_for("P-12"), "the auditor never saw the proposal"
    link = link_by_ref(rid, proposed["verse"])
    assert link is not None and link["relationship_type"] == "ai_related"
    assert link["review_status"] == "discarded" and link["confidence"] <= 0.6 and "audit_rejected" in link["review_reasons"]
    assert link["audit"] == {"decision": "rejected", "reason": "only shares the word faith"}
    assert visible_links(rid) == []
    intel = client.get(f"/v1/verses/{proposed['verse']}/intelligence").json()
    assert all(c["resource"]["id"] != rid for c in intel["top_resources"])
    assert client.get(f"/v1/resources/{rid}/verse-links").json()["total"] == 0


def test_ac03_unconfirmed_low_confidence_ai_candidate_is_index_only(client, login, fake_llm):
    """AC-03 A 0.70 P-04 candidate that the auditor does not reject is only indexed, never shown."""
    fake_llm.on("P-04", lambda call: {"accepted": [{"verse": call.json_line("CANDIDATES")[0]["verse"], "relationship": "thematic",
                                                    "evidence": "faith in the stock market", "why_related": "Mentions faith.", "confidence": 0.7}], "rejected": []})
    rid = native(client, login, GENERIC)
    (link,) = links_for(rid)
    assert link["relationship_type"] == "ai_related" and link["review_status"] == "index_only" and link["needs_review"] is True
    assert visible_links(rid) == []


def test_explicit_verse_citation_is_not_absorbed_by_a_chapter_reference(client, login):
    rid = native(client, login, "# Romans 8 study\n\nPaul writes in Romans 8:28 that God is at work in every season of life.")
    assert refs(links_for(rid)) == {"ROM.8.1-ROM.8.39", "ROM.8.28"}
    card = client.get("/v1/verses/ROM.8.28/intelligence").json()["top_resources"][0]
    assert card["relationship"]["label"] == "Direct Mention" and card["verse_ref"] == "ROM.8.28"


def test_small_passage_absorbs_contained_verse_but_keeps_verse_level_children(client, login):
    rid = native(client, login, "Tonight read Romans 8:28-30 slowly. Romans 8:29 is the heart of it.")
    assert refs(links_for(rid)) == {"ROM.8.28-ROM.8.30"}
    parent = link_by_ref(rid, "ROM.8.28-ROM.8.30")
    assert parent["mention_count"] == 2
    children = [l for l in links_for(rid, parents_only=False) if l["parent_link_id"] == parent["id"]]
    assert sorted(c["canonical_ref"] for c in children) == ["ROM.8.28", "ROM.8.29", "ROM.8.30"]
    card = client.get("/v1/verses/ROM.8.29/intelligence").json()["top_resources"][0]
    assert card["mapping_id"] in {c["id"] for c in children} and card["relationship"]["label"] == "Direct Mention"


# ----------------------------------------------------------------------------- AC-06 through the API
def test_ac06_labels_on_processed_resource_and_after_human_review(client, login):
    """AC-06 Unverified 0.80-0.89 direct mentions are labelled AI Related, >=0.90 as Direct Mention, and human-verified ones show human_verified."""
    rid = native(client, login, "We are reading Romans 8:28 this morning. Now look at verse thirty-one: if God is for us, who can be against us?")
    segments = client.get(f"/v1/resources/{rid}/segments").json()["segments"]
    labels = {m["verse_ref"]: m["relationship"] for s in segments for m in s["mappings"]}
    assert labels["ROM.8.28"]["label"] == "Direct Mention" and labels["ROM.8.28"]["type"] == "direct_reference"
    inferred = labels["ROM.8.31"]
    assert inferred["confidence"] < 0.9 and inferred["detected_type"] == "direct_reference"
    assert (inferred["type"], inferred["label"], inferred["human_verified"]) == ("ai_related", "AI Related", False)
    link = link_by_ref(rid, "ROM.8.31")
    assert link["review_status"] == "published" and link["needs_review"] is True
    approved = client.post(f"/v1/admin/mappings/{link['id']}/approve", json={"note": "context is clear"}, headers=login(EDITOR))
    assert approved.status_code == 200
    segments = client.get(f"/v1/resources/{rid}/segments").json()["segments"]
    after = {m["verse_ref"]: m["relationship"] for s in segments for m in s["mappings"]}["ROM.8.31"]
    assert (after["type"], after["label"], after["human_verified"], after["trust"]) == ("direct_reference", "Direct Mention", True, "Highest provenance")
    card = next(c for c in client.get("/v1/verses/ROM.8.31/intelligence").json()["top_resources"] if c["resource"]["id"] == rid)
    assert card["relationship"]["human_verified"] is True


# ----------------------------------------------------------------------------- AC-07
JOSEPH_TEXT = ("Think about Joseph. His brothers sold him as a slave, yet years later he told them that what they intended for harm "
               "God turned into good, so that many lives were saved.")


def _accept_first(evidence: str, confidence: float = 0.92):
    def mapper(call: FakeCall):
        cands = call.json_line("CANDIDATES")
        return {"accepted": [{"verse": cands[0]["verse"], "relationship": "narrative_parallel", "evidence": evidence,
                              "why_related": "The segment retells how God brought good out of harm.", "confidence": confidence}], "rejected": []}
    return mapper


def test_ac07_ungrounded_semantic_evidence_caps_confidence_and_flags_review(client, login, fake_llm):
    """AC-07 "Why related?" must be grounded: P-04 evidence that is not in the segment caps confidence at 0.75 and records semantic_evidence_not_grounded."""
    fake_llm.on("P-04", _accept_first("the valley of dry bones came to life"))
    rid = native(client, login, JOSEPH_TEXT)
    (link,) = [l for l in links_for(rid) if l["relationship_type"] == "ai_related"]
    assert link["confidence"] <= 0.75
    assert "semantic_evidence_not_grounded" in link["review_reasons"]
    assert link["review_status"] == "index_only" and link["needs_review"] is True
    assert link not in visible_links(rid)


def test_ac07_grounded_semantic_evidence_is_kept_with_explanation(client, login, fake_llm):
    """AC-07 Grounded P-04 evidence is stored with its offsets and the model's short explanation. Without retrieval support the
    match stays below the display bar (0.90): it is kept for search and review instead of being shown."""
    fake_llm.on("P-04", _accept_first("what they intended for harm God turned into good"))
    rid = native(client, login, JOSEPH_TEXT)
    (link,) = [l for l in links_for(rid) if l["relationship_type"] == "ai_related"]
    segment_text = sql_one("SELECT text_normalized FROM resource_segments WHERE id = :s", s=link["segment_id"])["text_normalized"]
    assert link["evidence_text"] == "what they intended for harm God turned into good" and link["evidence_text"] in segment_text
    offset = link["evidence_offsets"][0]
    assert segment_text[offset["start"]:offset["end"]] == link["evidence_text"]
    assert "semantic_evidence_not_grounded" not in link["review_reasons"]
    assert link["why_related"] == "The segment retells how God brought good out of harm."
    assert link["relationship_subtype"] == "narrative_parallel" and sorted(link["provenance"]["detectors"]) == ["P-04", "hybrid_retrieval"]
    assert link["confidence"] == pytest.approx(0.78) and "ai_match_below_display_bar" in link["review_reasons"]
    assert link["provenance"]["signals"]["ai_related"]["pre_policy_confidence"] == pytest.approx(0.88)  # no vector support: 0.92 -> 0.88
    assert link["review_status"] == "index_only" and link not in visible_links(rid)


def _vector_supported_mapper(accepted: list[tuple[str, str, float]]):
    def mapper(call: FakeCall):
        offered = {c["verse"] for c in call.json_line("CANDIDATES")}
        return {"accepted": [{"verse": v, "relationship": "thematic", "evidence": ev, "why_related": "Shares the segment's point.", "confidence": conf}
                             for v, ev, conf in accepted if v in offered], "rejected": []}
    return mapper


def test_ai_related_needs_high_confidence_and_retrieval_support_to_be_shown(client, login, fake_llm):
    """Precision first (§16.1): a grounded, retrieval-supported AI match at >= 0.90 is shown as AI Related; a 0.85 one is index only."""
    insert_fake_verse_embeddings([B.ordinal("2CO", 9, 7), B.ordinal("EXO", 35, 5)])
    text = "Nobody should give because they feel pressured. Generosity should come from a glad heart, not from guilt."
    fake_llm.on("P-04", _vector_supported_mapper([("2CO.9.7", "Generosity should come from a glad heart, not from guilt", 0.95),
                                                  ("EXO.35.5", "Nobody should give because they feel pressured", 0.85)]))
    rid = native(client, login, text)
    shown, weak = link_by_ref(rid, "2CO.9.7"), link_by_ref(rid, "EXO.35.5")
    assert shown["relationship_type"] == "ai_related" and shown["review_status"] == "published" and shown["confidence"] == pytest.approx(0.93)
    assert weak["review_status"] == "index_only" and "ai_match_below_display_bar" in weak["review_reasons"]


def test_ai_related_matches_for_the_same_words_show_only_the_strongest(client, login, fake_llm):
    insert_fake_verse_embeddings([B.ordinal("2CO", 9, 7), B.ordinal("EXO", 35, 5)])
    evidence = "Generosity should come from a glad heart, not from guilt"
    fake_llm.on("P-04", _vector_supported_mapper([("2CO.9.7", evidence, 0.97), ("EXO.35.5", evidence, 0.95)]))
    rid = native(client, login, "Nobody should give because they feel pressured. " + evidence + ".")
    assert link_by_ref(rid, "2CO.9.7")["review_status"] == "published"
    weaker = link_by_ref(rid, "EXO.35.5")
    assert weaker["review_status"] == "index_only" and "weaker_match_for_same_evidence" in weaker["review_reasons"]


def test_ai_related_verses_in_a_cited_sentence_are_cross_references_not_mappings(client, login, fake_llm):
    """A parallel passage proposed for the sentence that already cites Genesis 50:20 is not a separate claim of the resource."""
    insert_fake_verse_embeddings([B.ordinal("GEN", 45, 5), B.ordinal("PSA", 23, 4)])
    text = ("Joseph's words to his brothers in Gen 50:20 have carried me through many hard seasons. "
            "Even walking through the darkest valley, I will not be afraid, because you are with me.")
    fake_llm.on("P-04", _vector_supported_mapper([("GEN.45.5", "Joseph's words to his brothers", 0.95),
                                                  ("PSA.23.4", "Even walking through the darkest valley, I will not be afraid", 0.95)]))
    rid = native(client, login, text)
    assert link_by_ref(rid, "GEN.50.20")["review_status"] == "published"
    parallel = link_by_ref(rid, "GEN.45.5")
    assert parallel["review_status"] == "index_only" and "related_to_cited_passage" in parallel["review_reasons"]
    assert link_by_ref(rid, "PSA.23.4")["review_status"] == "published"  # its own sentence: a separate idea of the resource


def test_ac07_semantic_mapper_cannot_invent_verses_outside_candidates(client, login, fake_llm):
    """AC-07 P-04 can only choose verses from the retrieved candidates; invented verse ids are dropped."""
    fake_llm.on("P-04", lambda call: {"accepted": [{"verse": "REV.22.21", "relationship": "thematic", "evidence": "Think about Joseph",
                                                    "why_related": "Invented.", "confidence": 0.99}], "rejected": []})
    rid = native(client, login, JOSEPH_TEXT)
    assert "REV.22.21" not in refs(links_for(rid))
    assert all(l["relationship_type"] != "ai_related" for l in links_for(rid))


def test_ac07_openbible_related_verses_explain_votes_without_ai(client):
    """AC-07 Related verses from OpenBible cross references carry a template "why" that cites the contributor votes."""
    items = client.get("/v1/verses/ROM.8.28/related?limit=20").json()
    openbible = [i for i in items if i["sources"] == ["openbible"]]
    assert openbible, "ROM.8.28 should have OpenBible cross references in the test corpus"
    for item in openbible:
        m = re.fullmatch(r"Listed as a cross-reference by (\d+) OpenBible\.info contributors\.", item["why"])
        assert m, item["why"]
        assert item["why_status"] == "template" and item["label"] == "Cross-reference"
        rng = B.parse_canonical_range(item["ref"])
        votes = sql("SELECT evidence->>'votes' AS votes FROM verse_relationships WHERE source = 'openbible' AND from_verse_id = :f AND to_verse_id = :t",
                    f=45008028, t=rng[0])
        assert str(m.group(1)) in {v["votes"] for v in votes}


def test_ac07_why_related_on_demand_uses_p09_and_is_stored(client, fake_llm):
    """AC-07 "Why related?" on demand is generated by P-09 from both verse texts and stored for reuse."""
    items = client.get("/v1/verses/ROM.8.28/related?limit=5").json()
    target = items[0]
    assert target["why_status"] == "pending"  # AI available: an explanation can be generated
    first = client.get(f"/v1/verses/ROM.8.28/related/{target['ref']}/why").json()
    assert first["status"] == "generated" and first["why"] == "Both passages speak about God's faithful care for his people."
    assert first["provenance"]["prompt_id"] == "P-09"
    p09 = fake_llm.calls_for("P-09")[0]
    assert "Romans 8:28" in p09.section("SOURCE") and target["display_ref"].split(":")[0] in p09.section("TARGET_VERSE")
    second = client.get(f"/v1/verses/ROM.8.28/related/{target['ref']}/why").json()
    assert second["status"] == "ready" and second["why"] == first["why"]
    assert len(fake_llm.calls_for("P-09")) == 1


def test_ac07_low_confidence_explanations_are_not_shown_for_cross_references(client, fake_llm):
    """AC-07 An explanation the model marks as unsupported (low confidence) must not replace the grounded vote template."""
    fake_llm.on("P-09", {"why_related": "These passages are not clearly connected by the supplied texts.", "confidence": 0.2})
    target = client.get("/v1/verses/ROM.8.28/related?limit=5").json()[0]
    client.get(f"/v1/verses/ROM.8.28/related/{target['ref']}/why")
    again = next(i for i in client.get("/v1/verses/ROM.8.28/related?limit=5").json() if i["ref"] == target["ref"])
    assert again["why"].startswith("Listed as a cross-reference by")


def test_grounded_span_matching_rules():
    text = "He told them that they had meant it for harm, but God had meant it for good."
    assert grounded_span(text, "meant it for harm") == (text.index("meant it for harm"), text.index("meant it for harm") + len("meant it for harm"))
    assert grounded_span(text, "“GOD HAD MEANT IT FOR GOOD”") is not None
    assert grounded_span(text, "God had meant it for goood") is not None  # fuzzy
    assert grounded_span(text, "the valley of dry bones") is None
    assert grounded_span(text, "abc") is None
    assert best_sentence("One. Two words here. God meant good.", "God meant it for good") == "God meant good."

"""The full pipeline in AI mode with the fake Gemini client: the demo sermon captions end to end (P-01..P-08, P-12),
Gemini transcription (P-00) of real media, and graceful degradation when the provider fails."""
from __future__ import annotations

import json
from collections import Counter

import pytest

from interactive_bible.ai.gemini import GeminiError
from interactive_bible.ai.prompt_pack import prompt_versions
from interactive_bible.bible import books as B

from .fakes import FakeCall
from .support import (
    EDITOR,
    create_resource,
    insert_fake_verse_embeddings,
    link_by_ref,
    links_for,
    process_now,
    refs,
    sql,
    sql_one,
    upload,
)

GEN_50_20 = B.ordinal("GEN", 50, 20)
PIPELINE_PROMPTS = {"P-01", "P-02", "P-03", "P-04", "P-05", "P-06", "P-07", "P-08", "P-12"}


@pytest.fixture
def demo_sermon(project_root):
    from interactive_bible.cli import _register

    manifest = json.loads((project_root / "demo_content/manifest.json").read_text())
    item = next(m for m in manifest if m["key"] == "sermon_all_things_for_good")
    return _register(item, "usr_editor", transcript_mode="captions")


def joseph_mapper(call: FakeCall):
    """P-04 stand-in: relate Genesis 50:20 to any segment that talks about Joseph (evidence copied from the segment)."""
    segment = call.section("SEGMENT")
    candidates = [c["verse"] for c in call.json_line("CANDIDATES") or []]
    if "Joseph" in segment and "GEN.50.20" in candidates:
        sentence = next(s for s in segment.replace("\n", " ").split(". ") if "Joseph" in s)
        return {"accepted": [{"verse": "GEN.50.20", "relationship": "narrative_parallel", "evidence": sentence.strip(),
                              "why_related": "Joseph's story is where Genesis 50:20 says God meant harm for good.", "confidence": 0.9}],
                "rejected": [{"verse": v, "reason": "weak"} for v in candidates if v != "GEN.50.20"]}
    return {"accepted": [], "rejected": [{"verse": v, "reason": "weak"} for v in candidates]}


def test_ai_pipeline_on_demo_sermon_captions(demo_sermon, fake_llm):
    """Pipeline (AI mode, fake client) on the demo sermon captions: P-01..P-08 and P-12 run, prompt ids/versions are
    recorded in llm_calls, and P-04 creates an ai_related GEN.50.20 mapping in a segment that discusses Joseph."""
    insert_fake_verse_embeddings([GEN_50_20, B.ordinal("ROM", 8, 28), B.ordinal("PSA", 23, 1)])
    fake_llm.on("P-04", joseph_mapper)
    result = process_now(demo_sermon, triggered_by="usr_editor")
    run_id = result["run_id"]
    assert result["status"] == "succeeded" and result["degraded"] is False

    # --- every pipeline prompt ran and was logged against this run with the current prompt versions
    assert PIPELINE_PROMPTS <= set(fake_llm.prompt_ids())
    logged = sql("SELECT prompt_id, prompt_version, status, resource_id FROM llm_calls WHERE run_id = :r", r=run_id)
    assert PIPELINE_PROMPTS | {"EMBED"} <= {c["prompt_id"] for c in logged}
    versions = prompt_versions()
    assert all(c["status"] == "ok" for c in logged)
    assert all(c["prompt_version"] == versions[c["prompt_id"]] for c in logged if c["prompt_id"].startswith("P-"))
    assert {c["resource_id"] for c in logged if c["prompt_id"].startswith("P-")} == {demo_sermon}
    run = sql_one("SELECT prompt_versions, model_versions, metrics FROM processing_runs WHERE id = :r", r=run_id)
    assert run["prompt_versions"] == versions and run["model_versions"]["ai_enabled"] is True
    assert run["metrics"]["ai"]["calls"] == len(logged) and run["metrics"]["ai"]["failures"] == 0

    # --- P-01 segmentation, P-07 summaries, P-08 clips
    segments = sql("SELECT id, ordinal, start_ms, end_ms, boundary_reason, topic_hint, summary, summary_provenance, text_normalized, "
                   "clip_start_ms, clip_end_ms, clip_core_start_ms, clip_core_end_ms, clip_provenance FROM resource_segments WHERE resource_id = :r ORDER BY ordinal", r=demo_sermon)
    assert len(segments) >= 4 and {s["boundary_reason"] for s in segments} == {"fake_semantic_shift"}
    assert all(15_000 <= s["end_ms"] - s["start_ms"] <= 180_000 for s in segments)
    assert all(s["summary"].startswith("The speaker says:") and s["summary_provenance"]["prompt_id"] == "P-07" for s in segments)
    clipped = [s for s in segments if s["clip_start_ms"] is not None]
    assert clipped and all(s["clip_start_ms"] <= s["clip_core_start_ms"] <= s["clip_core_end_ms"] <= s["clip_end_ms"] for s in clipped)
    assert {s["clip_provenance"]["source"] for s in clipped} <= {"P-08", "deterministic_clip_rules"} and any(s["clip_provenance"]["source"] == "P-08" for s in clipped)

    # --- expected Scripture from the demo gold file (official resource: everything waits for editorial review)
    found = refs(links_for(demo_sermon))
    assert {"ROM.8.28", "ROM.8.37", "JER.29.11", "JAS.1.2-JAS.1.4", "GEN.50.15-GEN.50.21"} <= found
    assert not any(r.startswith("JHN.") for r in found)  # "My friend John" is not the Gospel of John
    assert {l["review_status"] for l in links_for(demo_sermon, parents_only=False)} <= {"pending_review", "discarded"}

    # --- the ai_related GEN.50.20 mapping, grounded in a segment about Joseph
    ai = [l for l in links_for(demo_sermon) if l["relationship_type"] == "ai_related" and l["verse_id"] == GEN_50_20]
    assert len(ai) == 1, [(l["canonical_ref"], l["relationship_type"]) for l in links_for(demo_sermon)]
    link = ai[0]
    segment = next(s for s in segments if s["id"] == link["segment_id"])
    assert "Joseph" in segment["text_normalized"] and link["evidence_text"] in segment["text_normalized"] and "Joseph" in link["evidence_text"]
    assert link["relationship_subtype"] == "narrative_parallel" and link["why_related"].startswith("Joseph's story")
    assert sorted(link["provenance"]["detectors"]) == ["P-04", "hybrid_retrieval"]
    assert link["confidence"] == pytest.approx(0.9) and link["provenance"]["signals"]["ai_related"]["vector_similarity"] != 0.0
    assert link["review_status"] == "pending_review" and "editorial_review_required" in link["review_reasons"]
    assert link["audit"] == {"decision": "approved"}
    assert {"P-04", "P-05", "P-12"} <= {c["prompt_id"] for c in link["provenance"]["ai_calls"]}

    # the segment that tells the story already covers GEN.50.20 through the named passage, so P-04 never re-proposed it there
    story = link_by_ref(demo_sermon, "GEN.50.15-GEN.50.21")
    assert story["relationship_type"] == "contextual_reference" and story["segment_id"] != link["segment_id"]
    story_calls = [c for c in fake_llm.calls_for("P-04") if "meant it for harm" in c.section("SEGMENT")]
    assert story_calls and all("GEN.50.15-GEN.50.21" in c.json_line("ALREADY_MAPPED") for c in story_calls)
    assert all("GEN.50.20" not in [x["verse"] for x in c.json_line("CANDIDATES")] for c in story_calls)


def test_ai_pipeline_second_run_is_served_from_llm_cache(demo_sermon, fake_llm):
    first = process_now(demo_sermon)
    n_calls = len(fake_llm.calls)
    second = process_now(demo_sermon)
    assert second["status"] == "succeeded" and len(fake_llm.calls) == n_calls  # nothing re-sent to the model
    statuses = Counter(r["status"] for r in sql("SELECT status FROM llm_calls WHERE run_id = :r AND prompt_id LIKE 'P-%'", r=second["run_id"]))
    assert set(statuses) == {"cached"}
    assert refs(links_for(demo_sermon)) and first["metrics"]["mappings_by_type"] == second["metrics"]["mappings_by_type"]


def test_ai_outage_degrades_to_deterministic_results(demo_sermon, fake_llm):
    """When every Gemini call fails the pipeline still publishes deterministic results, flags them and marks the run degraded."""
    def outage(_call):
        raise GeminiError("503 service unavailable", status=503, retryable=True)

    for pid in PIPELINE_PROMPTS:
        fake_llm.on(pid, outage)
    fake_llm.embed = lambda *a, **k: (_ for _ in ()).throw(GeminiError("embeddings down", status=503))  # type: ignore[method-assign]
    result = process_now(demo_sermon)
    assert result["status"] == "succeeded" and result["degraded"] is True
    assert {"ROM.8.28", "ROM.8.37", "JER.29.11"} <= refs(links_for(demo_sermon))
    notes = " ".join(result["metrics"]["notes"])
    assert "P-03 unavailable" in notes and "P-05 unavailable" in notes
    stages = {s["id"]: s["status"] for s in sql_one("SELECT stages FROM processing_runs WHERE id = :r", r=result["run_id"])["stages"]}
    assert stages["ING-08"] == "degraded"
    contextual = link_by_ref(demo_sermon, "GEN.50.15-GEN.50.21")
    assert "audit_unavailable" in contextual["review_reasons"] and contextual["provenance"]["degraded"] is True
    assert {r["status"] for r in sql("SELECT DISTINCT status FROM llm_calls WHERE run_id = :r", r=result["run_id"])} == {"error:error"}


def test_gemini_transcription_of_uploaded_media(client, login, fake_llm, silent_mp3):
    """ING-03 P-00: media without captions is transcribed (chunk cached per hash), repaired and mapped with timestamps."""
    fake_llm.on("P-00", {"language": "en", "utterances": [
        {"start": 0.5, "end": 4.0, "speaker": "S1", "text": "Welcome to this short reflection."},
        {"start": 3.5, "end": 9.0, "speaker": "S1", "text": "Tonight we read John 3:16 together. God loves the world."},
        {"start": 9.5, "end": 9.5, "speaker": "S1", "text": "[music]"},
    ]})
    res = create_resource(client, login(EDITOR), type="audio", title="Spoken reflection", transcript_mode="gemini", speaker="Pastor Ann")
    assert upload(client, login(EDITOR), res["id"], silent_mp3, "reflection.mp3").status_code == 200
    result = process_now(res["id"])
    assert result["status"] == "succeeded"
    transcript = sql_one("SELECT method, method_version, model, units, diagnostics FROM resource_transcripts WHERE resource_id = :r", r=res["id"])
    assert transcript["method"] == "gemini_transcription" and transcript["method_version"] == "gemini-chunked-1"
    chunk = transcript["diagnostics"]["chunks"][0]
    assert chunk["start_s"] == 0.0 and "overlap_fixed" in chunk["repairs"] and chunk["utterances"] == 3
    texts = [u["text"] for u in transcript["units"]]
    assert "[music]" not in " ".join(texts) and "Tonight we read John 3:16 together." in texts
    assert {u["speaker"] for u in transcript["units"]} == {"Pastor Ann"}  # single diarised speaker takes the hint
    link = link_by_ref(res["id"], "JHN.3.16")
    assert link["relationship_type"] == "direct_reference" and link["evidence_offsets"][0]["start_ms"] >= 4000
    p00 = fake_llm.calls_for("P-00")
    assert len(p00) == 1 and p00[0].parts[0]["inlineData"]["mimeType"] == "audio/mp3" and "CLIP_DURATION_SECONDS: 20" in p00[0].text
    # force_retranscribe re-uses the per-chunk LLM cache instead of paying for transcription again
    process_now(res["id"], {"force_retranscribe": True})
    assert len(fake_llm.calls_for("P-00")) == 1
    assert sql_one("SELECT status FROM llm_calls WHERE prompt_id = 'P-00' ORDER BY id DESC LIMIT 1")["status"] == "cached"


def test_media_without_captions_fails_clearly_when_ai_is_not_configured(client, login, no_llm, silent_mp3):
    res = create_resource(client, login(EDITOR), type="audio", title="No captions", transcript_mode="auto")
    upload(client, login(EDITOR), res["id"], silent_mp3, "memo.mp3")
    from interactive_bible.ai.llm import AIUnavailable

    with pytest.raises(AIUnavailable, match="captions"):
        process_now(res["id"])
    run = sql_one("SELECT status, error FROM processing_runs WHERE resource_id = :r", r=res["id"])
    assert run["status"] == "failed" and "GEMINI_API_KEY" in run["error"]
    assert sql_one("SELECT status FROM resources WHERE id = :r", r=res["id"])["status"] == "failed"


def test_ai_reference_verification_corrects_asr_split(client, login, fake_llm):
    """P-02 confirms or corrects uncertain parser candidates (e.g. the ASR form 'John 316')."""
    fake_llm.on("P-02", lambda call: {"references": [
        {"raw_text": "John 316", "canonical_start": "JHN.3.16", "canonical_end": "JHN.3.16", "evidence_quote": "John 316", "confidence": 0.95},
        {"raw_text": "Romans 8:28", "canonical_start": "ROM.8.28", "canonical_end": "ROM.8.28", "evidence_quote": "Romans 8:28", "confidence": 0.99},
        {"raw_text": "Hebrews 11:1", "canonical_start": "HEB.11.1", "canonical_end": "HEB.11.1", "evidence_quote": "the definition of faith", "confidence": 0.9},
    ]})
    text = "Everybody knows John 316 even if they never opened a Bible. We read Romans 8:28 today; now look at verse thirty-one."
    res = create_resource(client, login(EDITOR), type="native", title="ASR text", body_text=text)
    process_now(res["id"])
    confirmed = link_by_ref(res["id"], "JHN.3.16")
    assert confirmed["confidence"] >= 0.95 and "P-02" in confirmed["provenance"]["detectors"]
    assert confirmed["provenance"]["signals"]["direct_reference"]["p02"] == "confirmed" and confirmed["review_status"] == "published"
    unconfirmed = link_by_ref(res["id"], "ROM.8.31")
    assert unconfirmed["provenance"]["signals"]["direct_reference"]["p02"] == "not_confirmed"
    assert "llm_did_not_confirm_reference" in unconfirmed["review_reasons"] and unconfirmed["review_status"] == "discarded"
    # a reference the model "adds" without grounding in the text is ignored
    assert link_by_ref(res["id"], "HEB.11.1") is None

"""LLM service behaviour with a fake Gemini client: validation + one retry, caching, call log, budget, degradation."""
from __future__ import annotations

import pytest

from interactive_bible.ai import schemas as S
from interactive_bible.ai.gemini import GeminiError, extract_json
from interactive_bible.ai.llm import AIInvalidOutput, AIUnavailable, LLMService, get_llm
from interactive_bible.ai.prompt_pack import get_prompt, load_prompts, prompt_versions
from interactive_bible.config import get_settings

from .support import sql, sql_exec

SUMMARY_VARS = {"segment_text": "Paul writes that all things work together for good (Romans 8:28).", "mappings": ["ROM.8.28"]}

SCHEMAS = {
    "P-00": S.TranscriptOut, "P-01": S.SegmenterOut, "P-02": S.RefExtractorOut, "P-03": S.QuoteVerifierOut, "P-04": S.SemanticMapperOut,
    "P-05": S.ClassifierOut, "P-06": S.TaggerOut, "P-07": S.SummaryOut, "P-08": S.ClipOut, "P-09": S.WhyOut, "P-10": S.SearchParseOut,
    "P-11": S.RerankOut, "P-12": S.AuditOut, "P-13": S.CaptionOut, "P-14": S.AskOut, "P-15": S.TaggerOut,
}


def calls(prompt_id: str) -> list[dict]:
    return sql("SELECT prompt_id, prompt_version, model, status, cached, run_id, resource_id, error, prompt_tokens FROM llm_calls WHERE prompt_id = :p ORDER BY id", p=prompt_id)


@pytest.mark.nodb
def test_prompt_pack_has_every_prompt_with_versioned_system_rules():
    prompts = load_prompts()
    assert sorted(p for p in prompts if p.startswith("P-")) == [f"P-{i:02d}" for i in range(17)]
    assert {pid.split("-")[0] for pid in prompts} <= {"P", "S", "E"}
    versions = prompt_versions()
    for pid, prompt in prompts.items():
        assert prompt.system.startswith("SYSTEM RULES")
        assert versions[pid].startswith(prompt.semver + "+") and len(versions[pid].split("+")[1]) == 10
        assert "OUTPUT SCHEMA" in prompt.body
    with pytest.raises(KeyError, match="missing prompt variables"):
        get_prompt("P-07").render({"segment_text": "only one variable"})


@pytest.mark.nodb
def test_extract_json_accepts_fenced_and_wrapped_output():
    assert extract_json('```json\n{"summary": "x"}\n```') == {"summary": "x"}
    assert extract_json('Sure! {"summary": "y"} Hope that helps.') == {"summary": "y"}
    with pytest.raises(ValueError):
        extract_json("no json here")


def test_invalid_json_then_valid_json_retries_once_and_logs_both_calls(fake_llm):
    fake_llm.queue("P-07", "Sorry, here is prose instead of JSON", {"summary": "Paul says God works all things for good."})
    result = get_llm().run("P-07", SUMMARY_VARS, S.SummaryOut, resource_id="res_test", run_id="run_test")
    assert result.output.summary == "Paul says God works all things for good." and result.cached is False
    assert [c["status"] for c in calls("P-07")] == ["invalid_json", "ok"]
    assert all(c["run_id"] == "run_test" and c["resource_id"] == "res_test" for c in calls("P-07"))
    assert "YOUR PREVIOUS OUTPUT WAS INVALID" in fake_llm.calls_for("P-07")[1].text
    assert "YOUR PREVIOUS OUTPUT WAS INVALID" not in fake_llm.calls_for("P-07")[0].text


def test_schema_invalid_output_also_counts_as_invalid(fake_llm):
    fake_llm.queue("P-12", {"approved": "ROM.8.28", "rejected": [{"reason": "missing verse"}]})
    result = get_llm().run("P-12", {"segment_text": "x", "mappings": [{"verse": "ROM.8.28"}], "bible_texts": {}}, S.AuditOut)
    assert result.output.approved == ["ROM.8.28"]
    assert [c["status"] for c in calls("P-12")] == ["invalid_json", "ok"]


def test_invalid_twice_raises_and_is_not_cached(fake_llm):
    fake_llm.queue("P-07", "nope", "still nope")
    with pytest.raises(AIInvalidOutput):
        get_llm().run("P-07", SUMMARY_VARS, S.SummaryOut)
    assert [c["status"] for c in calls("P-07")] == ["invalid_json", "invalid_json"]
    assert sql("SELECT count(*) AS n FROM llm_cache")[0]["n"] == 0


def test_second_identical_call_is_served_from_cache(fake_llm):
    llm = get_llm()
    first = llm.run("P-07", SUMMARY_VARS, S.SummaryOut)
    second = llm.run("P-07", SUMMARY_VARS, S.SummaryOut)
    assert first.cached is False and second.cached is True
    assert second.output == first.output
    assert len(fake_llm.calls_for("P-07")) == 1
    assert [(c["status"], c["cached"]) for c in calls("P-07")] == [("ok", False), ("cached", True)]
    cache_row = sql("SELECT prompt_id, prompt_version, output FROM llm_cache")
    assert len(cache_row) == 1 and cache_row[0]["prompt_version"] == get_prompt("P-07").version
    # different input, salt or use_cache=False all bypass the cache
    llm.run("P-07", {**SUMMARY_VARS, "mappings": ["ROM.8.29"]}, S.SummaryOut)
    llm.run("P-07", SUMMARY_VARS, S.SummaryOut, cache_salt="chunk-2")
    llm.run("P-07", SUMMARY_VARS, S.SummaryOut, use_cache=False)
    assert len(fake_llm.calls_for("P-07")) == 4


def test_daily_token_budget_exhaustion_raises_ai_unavailable(fake_llm, monkeypatch):
    monkeypatch.setattr(get_settings(), "gemini_daily_token_budget", 1000)
    sql_exec("INSERT INTO llm_calls (prompt_id, prompt_version, model, input_hash, status, prompt_tokens, output_tokens) VALUES ('P-04', 'v', 'm', 'h', 'ok', 900, 150)")
    with pytest.raises(AIUnavailable, match="budget"):
        get_llm().run("P-07", SUMMARY_VARS, S.SummaryOut)
    with pytest.raises(AIUnavailable, match="budget"):
        get_llm().embed(["some text"])
    assert fake_llm.calls == [] and fake_llm.embed_calls == []


def test_cached_calls_do_not_count_towards_the_budget(fake_llm, monkeypatch):
    monkeypatch.setattr(get_settings(), "gemini_daily_token_budget", 1000)
    sql_exec("INSERT INTO llm_calls (prompt_id, prompt_version, model, input_hash, status, cached, prompt_tokens) VALUES ('P-04', 'v', 'm', 'h', 'cached', true, 5000)")
    assert get_llm().run("P-07", SUMMARY_VARS, S.SummaryOut).output.summary


def test_provider_error_degrades_to_ai_unavailable_and_is_logged(fake_llm):
    def quota(_call):
        raise GeminiError("quota exceeded for the day", status=429, kind="quota")

    fake_llm.on("P-07", quota)
    with pytest.raises(AIUnavailable, match="P-07"):
        get_llm().run("P-07", SUMMARY_VARS, S.SummaryOut)
    assert [c["status"] for c in calls("P-07")] == ["error:quota"]


def test_recitation_error_is_retried_once(fake_llm):
    state = {"n": 0}

    def flaky(_call):
        state["n"] += 1
        if state["n"] == 1:
            raise GeminiError("stopped for recitation", kind="recitation", retryable=True)
        return {"summary": "ok"}

    fake_llm.on("P-07", flaky)
    assert get_llm().run("P-07", SUMMARY_VARS, S.SummaryOut).output.summary == "ok"
    assert [c["status"] for c in calls("P-07")] == ["error:recitation", "ok"]


def test_unconfigured_client_raises_without_calling(no_llm):
    llm = get_llm()
    assert llm.available is False
    with pytest.raises(AIUnavailable, match="not configured"):
        llm.run("P-07", SUMMARY_VARS, S.SummaryOut)
    with pytest.raises(AIUnavailable):
        llm.embed(["x"])


def test_embeddings_are_normalised_and_logged(fake_llm):
    vectors, model = get_llm().embed(["first text", "second text"], "RETRIEVAL_QUERY", run_id="run_e")
    settings = get_settings()
    assert model == settings.gemini_embed_model and len(vectors) == 2
    assert all(len(v) == settings.embedding_dim and abs(sum(x * x for x in v) - 1.0) < 1e-6 for v in vectors)
    row = sql("SELECT prompt_id, prompt_version, status, run_id FROM llm_calls")
    assert row == [{"prompt_id": "EMBED", "prompt_version": "RETRIEVAL_QUERY", "status": "ok", "run_id": "run_e"}]
    assert get_llm().embed([]) == ([], settings.gemini_embed_model)


def test_llm_service_with_explicit_client_does_not_touch_global_state(fake_llm):
    from .fakes import FakeGeminiClient

    private = FakeGeminiClient()
    assert LLMService(private).run("P-09", {"source_text_or_verse": "a", "target_verse_text": "b", "relationship_type": "thematic", "evidence": "c"}, S.WhyOut).output.confidence == 0.82
    assert len(private.calls) == 1 and fake_llm.calls == []


@pytest.mark.nodb
@pytest.mark.parametrize("prompt_id", sorted(SCHEMAS))
def test_fake_client_default_outputs_validate_against_prompt_schemas(prompt_id):
    """Guards the test double itself: every default fake response must be schema-valid for its prompt."""
    from .fakes import FakeGeminiClient

    samples = {
        "P-00": "CLIP_DURATION_SECONDS: 20.0\nLANGUAGE_HINT: en\nSPEAKER_HINT: unknown",
        "P-01": "UNITS (id, start_s, end_s, speaker, has_scripture, text):\n<<<\nu0001 | 0.0 | 20.0 | - | false | Hello.\nu0002 | 20.3 | 70.0 | - | true | Romans 8:28.\n>>>",
        "P-02": 'SEGMENT:\n<<<\nRead John 316.\n>>>\nPARSER_CANDIDATES: [{"canonical": "JHN.3.16", "raw_text": "John 316", "flags": ["asr_split"]}]',
        "P-03": 'SEGMENT:\n<<<\nFor God so loved the world.\n>>>\nCANDIDATES (verse id, translation, text, lexical_overlap):\n[{"verse": "JHN.3.16", "translation": "WEB", "text": "For God so loved the world", "lexical_overlap": 0.7}]',
        "P-04": 'SEGMENT:\n<<<\nx\n>>>\nALREADY_MAPPED: []\nCANDIDATES (verse id, text):\n[{"verse": "ROM.8.28", "text": "We know"}]',
        "P-05": 'DIRECT_REFERENCES: [{"verse": "ROM.8.28", "confidence": 0.99, "evidence": "Romans 8:28"}]\nQUOTE_MATCHES: []\nCONTEXTUAL_REFERENCES: []\nSEMANTIC_MATCHES: []',
        "P-06": 'SEGMENT:\n<<<\nfaith and hope\n>>>\nMAPPED_VERSES: []\nTOPIC_VOCAB: ["Faith", "Hope"]\nENTITY_VOCAB: {"event": []}',
        "P-07": "SEGMENT:\n<<<\nPaul writes about hope.\n>>>\nMAPPED_VERSES: []",
        "P-08": "TIMESTAMPED_UNITS (id, start_ms, end_ms, text):\n<<<\nu0001 | 0 | 20000 | Romans 8:28\nu0002 | 20300 | 40000 | explained\n>>>\nCORE_EVIDENCE:\n<<<\nRomans 8:28\n>>>\nTARGET_VERSE: ROM.8.28",
        "P-11": 'QUERY:\n<<<\nhope\n>>>\nCANDIDATES:\n<<<\n[{"id": "verse:ROM.8.28"}, {"id": "segment:seg_1"}]\n>>>',
        "P-12": 'SEGMENT:\n<<<\nx\n>>>\nPROPOSED_MAPPINGS: [{"verse": "ROM.8.28"}]\nBIBLE_TEXTS: {}',
        "P-10": 'QUERY:\n<<<\nsermons about Romans 8:28 and hope\n>>>\nLOCALE: en\nTOPIC_VOCAB: ["Hope"]\nENTITY_VOCAB: []',
        "P-13": "VERSE: Romans 8:28\nVERSE_TEXT:\n<<<\nWe know\n>>>",
        "P-14": "SELECTED_VERSE: ROM.8.28 (Romans 8:28)\nVERSE_TEXTS:\n<<<\nx\n>>>",
    }
    fake = FakeGeminiClient()
    text = samples.get(prompt_id, "")
    result = fake.generate("model", "system", [{"text": text}], prompt_id=prompt_id)
    SCHEMAS[prompt_id].model_validate(extract_json(result.text))

"""Wire-format tests for the Gemini REST client (no network: httpx.MockTransport).

Field names were verified against the public discovery document
https://generativelanguage.googleapis.com/$discovery/rest?version=v1beta
"""
import json

import httpx
import pytest

from interactive_bible.ai import gemini as G
from interactive_bible.ai.schemas import SemanticMapperOut
from interactive_bible.config import Settings


def make_client(handler, **overrides):
    settings = Settings(gemini_api_key="test-key", gemini_max_rpm=10_000, gemini_model_fallbacks="gemini-2.5-flash", **overrides)
    client = G.GeminiClient(settings)
    client._http = httpx.Client(transport=httpx.MockTransport(handler))
    return client


def ok_response(text, model_version="gemini-2.5-flash", thought=False):
    parts = ([{"text": "thinking...", "thought": True}] if thought else []) + [{"text": text}]
    return httpx.Response(200, json={
        "candidates": [{"content": {"parts": parts, "role": "model"}, "finishReason": "STOP"}],
        "usageMetadata": {"promptTokenCount": 11, "candidatesTokenCount": 7, "thoughtsTokenCount": 3},
        "modelVersion": model_version,
    })


@pytest.fixture(autouse=True)
def no_sleep(monkeypatch):
    monkeypatch.setattr(G.time, "sleep", lambda *_: None)


def test_generate_request_shape_and_parsing():
    seen = {}

    def handler(request: httpx.Request):
        seen["url"] = str(request.url)
        seen["key"] = request.headers.get("x-goog-api-key")
        seen["body"] = json.loads(request.content)
        return ok_response('{"accepted": [], "rejected": []}', thought=True)

    client = make_client(handler)
    schema = G.to_json_schema(SemanticMapperOut)
    res = client.generate("gemini-2.5-flash", "SYSTEM", [{"inlineData": {"mimeType": "audio/mp3", "data": "AAAA"}}, {"text": "hello"}], temperature=0.1, json_schema=schema)
    assert seen["url"].endswith("/v1beta/models/gemini-2.5-flash:generateContent")
    assert seen["key"] == "test-key"
    body = seen["body"]
    assert body["systemInstruction"] == {"parts": [{"text": "SYSTEM"}]}
    assert body["contents"][0]["parts"][0]["inlineData"]["mimeType"] == "audio/mp3"
    cfg = body["generationConfig"]
    assert cfg["responseMimeType"] == "application/json" and "responseJsonSchema" in cfg and cfg["temperature"] == 0.1
    assert "thinkingConfig" not in cfg
    assert {s["threshold"] for s in body["safetySettings"]} == {"BLOCK_ONLY_HIGH"}
    assert res.text == '{"accepted": [], "rejected": []}'  # thought parts excluded
    assert (res.prompt_tokens, res.output_tokens, res.thought_tokens) == (11, 7, 3)


def test_schema_fallback_to_openapi_subset():
    calls = []

    def handler(request):
        body = json.loads(request.content)
        calls.append(body["generationConfig"])
        if "responseJsonSchema" in body["generationConfig"]:
            return httpx.Response(400, json={"error": {"code": 400, "message": 'Invalid JSON payload received. Unknown name "responseJsonSchema" at \'generation_config\'', "status": "INVALID_ARGUMENT"}})
        return ok_response("{}")

    client = make_client(handler)
    client.generate("gemini-2.5-flash", "", [{"text": "x"}], json_schema=G.to_json_schema(SemanticMapperOut))
    assert "responseJsonSchema" in calls[0] and "responseSchema" in calls[1]
    assert calls[1]["responseSchema"]["type"] == "OBJECT"
    # remembered for the next call
    client.generate("gemini-2.5-flash", "", [{"text": "y"}], json_schema=G.to_json_schema(SemanticMapperOut))
    assert "responseSchema" in calls[2]


def test_model_fallback_on_404():
    models = []

    def handler(request):
        model = request.url.path.split("/models/")[1].split(":")[0]
        models.append(model)
        if model == "gemini-flash-latest":
            return httpx.Response(404, json={"error": {"code": 404, "message": "models/gemini-flash-latest is not found", "status": "NOT_FOUND"}})
        return ok_response("{}")

    client = make_client(handler)
    res = client.generate("gemini-flash-latest", "", [{"text": "x"}])
    assert models == ["gemini-flash-latest", "gemini-2.5-flash"]
    assert res.model == "gemini-2.5-flash"
    client.generate("gemini-flash-latest", "", [{"text": "x"}])
    assert models[-1] == "gemini-2.5-flash"  # resolved alias is reused


def test_rate_limit_retry_then_success():
    attempts = []

    def handler(request):
        attempts.append(1)
        if len(attempts) < 3:
            return httpx.Response(429, json={"error": {"code": 429, "message": "Resource has been exhausted", "status": "RESOURCE_EXHAUSTED",
                                                        "details": [{"@type": "type.googleapis.com/google.rpc.RetryInfo", "retryDelay": "2s"}]}})
        return ok_response("{}")

    client = make_client(handler)
    client.generate("gemini-2.5-flash", "", [{"text": "x"}])
    assert len(attempts) == 3


def test_auth_error_is_not_retried():
    attempts = []

    def handler(request):
        attempts.append(1)
        return httpx.Response(403, json={"error": {"code": 403, "message": "API key not valid", "status": "PERMISSION_DENIED"}})

    client = make_client(handler)
    with pytest.raises(G.GeminiError) as err:
        client.generate("gemini-2.5-flash", "", [{"text": "x"}])
    assert err.value.kind == "auth" and len(attempts) == 1


def test_gemini3_uses_default_temperature_and_thinking_level():
    configs = []

    def handler(request):
        configs.append(json.loads(request.content)["generationConfig"])
        return ok_response("{}", model_version="gemini-3-flash-preview")

    client = make_client(handler)
    client.generate("gemini-flash-latest", "", [{"text": "x"}], temperature=0.0)
    client.generate("gemini-flash-latest", "", [{"text": "x"}], temperature=0.0)
    for cfg in configs:  # "-latest" aliases are treated as the current generation even before modelVersion is known
        assert "temperature" not in cfg and cfg["thinkingConfig"] == {"thinkingLevel": "LOW"}


def test_alias_resolving_to_an_older_generation_gets_temperature_and_no_thinking_level():
    configs = []

    def handler(request):
        cfg = json.loads(request.content)["generationConfig"]
        configs.append(cfg)
        if "thinkingConfig" in cfg:
            return httpx.Response(400, json={"error": {"code": 400, "message": "Thinking level is not supported for this model.", "status": "INVALID_ARGUMENT"}})
        return ok_response("{}", model_version="gemini-2.5-flash")

    client = make_client(handler)
    client.generate("gemini-flash-latest", "", [{"text": "x"}], temperature=0.2)
    client.generate("gemini-flash-latest", "", [{"text": "x"}], temperature=0.2)
    assert len(configs) == 3 and "thinkingConfig" not in configs[1]
    assert configs[2]["temperature"] == 0.2 and "thinkingConfig" not in configs[2]
    client.generate("gemini-2.5-flash", "", [{"text": "x"}], temperature=0.2)
    assert configs[3]["temperature"] == 0.2 and "thinkingConfig" not in configs[3]


def test_thinking_config_dropped_when_rejected():
    configs = []

    def handler(request):
        cfg = json.loads(request.content)["generationConfig"]
        configs.append(cfg)
        if "thinkingConfig" in cfg:
            return httpx.Response(400, json={"error": {"code": 400, "message": "Thinking level is not supported for this model.", "status": "INVALID_ARGUMENT"}})
        return ok_response("{}", model_version="gemini-3-pro-preview")

    client = make_client(handler)
    client.generate("gemini-3-pro-preview", "", [{"text": "x"}])
    assert "thinkingConfig" in configs[0] and "thinkingConfig" not in configs[1]


def test_recitation_and_blocked_responses():
    def recitation(request):
        return httpx.Response(200, json={"candidates": [{"content": {"parts": []}, "finishReason": "RECITATION"}]})

    with pytest.raises(G.GeminiError) as err:
        make_client(recitation).generate("gemini-2.5-flash", "", [{"text": "x"}])
    assert err.value.kind == "recitation"

    def blocked(request):
        return httpx.Response(200, json={"promptFeedback": {"blockReason": "SAFETY"}})

    with pytest.raises(G.GeminiError) as err:
        make_client(blocked).generate("gemini-2.5-flash", "", [{"text": "x"}])
    assert err.value.kind == "blocked"


def test_embed_request_shape_batching_and_truncation():
    bodies = []

    def handler(request):
        body = json.loads(request.content)
        bodies.append(body)
        assert str(request.url).endswith("/v1beta/models/gemini-embedding-001:batchEmbedContents")
        return httpx.Response(200, json={"embeddings": [{"values": [0.1] * 3072} for _ in body["requests"]], "usageMetadata": {"promptTokenCount": 5}})

    client = make_client(handler)
    res = client.embed("gemini-embedding-001", [f"text {i}" for i in range(150)], "RETRIEVAL_DOCUMENT", 768)
    assert len(bodies) == 2 and len(bodies[0]["requests"]) == 100 and len(bodies[1]["requests"]) == 50
    req = bodies[0]["requests"][0]
    assert req["model"] == "models/gemini-embedding-001"
    assert req["content"] == {"parts": [{"text": "text 0"}]}
    # request-level fields: the live batchEmbedContents endpoint silently ignores a nested embedContentConfig
    assert req["taskType"] == "RETRIEVAL_DOCUMENT" and req["outputDimensionality"] == 768
    assert "embedContentConfig" not in req
    assert len(res.vectors) == 150 and all(len(v) == 768 for v in res.vectors)
    assert res.input_tokens_estimate == 10


def test_embed_nested_config_fallback():
    bodies = []

    def handler(request):
        body = json.loads(request.content)
        bodies.append(body)
        if "taskType" in body["requests"][0]:
            return httpx.Response(400, json={"error": {"code": 400, "message": 'Invalid JSON payload received. Unknown name "taskType" at \'requests[0]\'', "status": "INVALID_ARGUMENT"}})
        return httpx.Response(200, json={"embeddings": [{"values": [0.2] * 768} for _ in body["requests"]]})

    client = make_client(handler)
    res = client.embed("text-embedding-next", ["a", "b"], "RETRIEVAL_QUERY", 768)
    assert bodies[1]["requests"][0]["embedContentConfig"] == {"taskType": "RETRIEVAL_QUERY", "outputDimensionality": 768, "autoTruncate": True}
    assert len(res.vectors) == 2
    client.embed("text-embedding-next", ["c"], "RETRIEVAL_QUERY", 768)
    assert "embedContentConfig" in bodies[2]["requests"][0]  # remembered per model


def test_extract_json_variants():
    assert G.extract_json('```json\n{"a": 1}\n```') == {"a": 1}
    assert G.extract_json('Here you go: {"a": [1, 2]} thanks') == {"a": [1, 2]}


def test_openapi_conversion_handles_nullable_and_enums():
    from interactive_bible.ai.schemas import ClassifierOut

    out = G.to_openapi_schema(G.to_json_schema(ClassifierOut))
    assert out["properties"]["primary_verse"]["nullable"] is True
    rel = out["properties"]["relationships"]["items"]["properties"]["type"]
    assert rel["type"] == "STRING" and "direct_reference" in rel["enum"]


def test_image_generation_request_shape_and_decoding():
    import base64

    seen = {}

    def handler(request):
        seen["url"] = str(request.url)
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, json={
            "candidates": [{"content": {"parts": [{"inlineData": {"mimeType": "image/jpeg", "data": base64.b64encode(b"\xff\xd8jpeg").decode()}}]}, "finishReason": "STOP"}],
            "usageMetadata": {"promptTokenCount": 20, "candidatesTokenCount": 1120}, "modelVersion": "gemini-3.1-flash-image",
        })

    client = make_client(handler)
    res = client.generate_image("an olive grove", ["gemini-3.1-flash-image"], aspect_ratio="9:16", image_size="1K")
    assert seen["url"].endswith("/v1beta/models/gemini-3.1-flash-image:generateContent")
    cfg = seen["body"]["generationConfig"]
    assert cfg == {"responseModalities": ["IMAGE"], "imageConfig": {"aspectRatio": "9:16", "imageSize": "1K"}}
    assert (res.data, res.mime_type, res.output_tokens) == (b"\xff\xd8jpeg", "image/jpeg", 1120)


def test_image_config_rejection_retries_without_it_and_missing_models_fall_back():
    import base64

    bodies = []

    def handler(request):
        model = request.url.path.split("/models/")[1].split(":")[0]
        body = json.loads(request.content)
        bodies.append((model, body["generationConfig"]))
        if model == "gone-image-model":
            return httpx.Response(404, json={"error": {"code": 404, "message": "not found", "status": "NOT_FOUND"}})
        if "imageConfig" in body["generationConfig"]:
            return httpx.Response(400, json={"error": {"code": 400, "message": "imageConfig is not supported for this model", "status": "INVALID_ARGUMENT"}})
        return httpx.Response(200, json={"candidates": [{"content": {"parts": [{"inlineData": {"mimeType": "image/png", "data": base64.b64encode(b"png").decode()}}]}}]})

    client = make_client(handler)
    res = client.generate_image("x", ["gone-image-model", "old-image-model"])
    assert [m for m, _ in bodies] == ["gone-image-model", "old-image-model", "old-image-model"]
    assert "imageConfig" not in bodies[-1][1] and res.data == b"png"


def test_image_model_returning_no_image_is_an_error():
    def handler(request):
        return httpx.Response(200, json={"candidates": [{"content": {"parts": [{"text": "I cannot draw that"}]}, "finishReason": "STOP"}]})

    with pytest.raises(G.GeminiError) as err:
        make_client(handler).generate_image("x", ["gemini-3.1-flash-image"])
    assert err.value.kind == "no_media"


def test_speech_request_shape_and_pcm_is_wrapped_as_wav():
    import base64
    import io
    import wave

    seen = {}
    pcm = b"\x01\x00" * 24000  # one second of 16-bit mono at 24 kHz

    def handler(request):
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, json={"candidates": [{"content": {"parts": [{"inlineData": {"mimeType": "audio/L16;codec=pcm;rate=24000", "data": base64.b64encode(pcm).decode()}}]}}],
                                         "usageMetadata": {"promptTokenCount": 16, "candidatesTokenCount": 25}})

    client = make_client(handler)
    res = client.synthesize_speech("In the beginning", ["gemini-3.1-flash-tts-preview"], voice="Charon", style="Read warmly")
    cfg = seen["body"]["generationConfig"]
    assert cfg == {"responseModalities": ["AUDIO"], "speechConfig": {"voiceConfig": {"prebuiltVoiceConfig": {"voiceName": "Charon"}}}}
    assert seen["body"]["contents"][0]["parts"][0]["text"] == "Read warmly:\n\nIn the beginning"
    assert res.mime_type == "audio/wav" and res.duration_seconds == pytest.approx(1.0)
    with wave.open(io.BytesIO(res.data)) as w:
        assert (w.getframerate(), w.getnchannels(), w.getsampwidth(), w.getnframes()) == (24000, 1, 2, 24000)


@pytest.mark.nodb
def test_schema_inlining_keeps_fields_named_title():
    from pydantic import BaseModel

    class Scene(BaseModel):
        title: str
        narration: str

    class Story(BaseModel):
        title: str
        scenes: list[Scene]

    schema = G.to_json_schema(Story)
    assert "title" not in schema and set(schema["properties"]) == {"title", "scenes"}
    assert set(schema["required"]) <= set(schema["properties"])
    scene = schema["properties"]["scenes"]["items"]
    assert set(scene["properties"]) == {"title", "narration"} and "title" not in scene and "$ref" not in scene
    openapi = G.to_openapi_schema(schema)
    assert set(openapi["properties"]["scenes"]["items"]["properties"]) == {"title", "narration"}

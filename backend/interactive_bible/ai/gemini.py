"""Minimal, dependency-light Gemini REST client (generateContent, batchEmbedContents, models.list).

This is the ONLY component that talks to a remote AI service. Everything else is local.
"""
from __future__ import annotations

import copy
import json
import logging
import random
import re
import threading
import time
from dataclasses import dataclass, field
from typing import Any

import httpx

from ..config import Settings, get_settings

log = logging.getLogger(__name__)


class GeminiError(Exception):
    def __init__(self, message: str, status: int | None = None, retryable: bool = False, kind: str = "error") -> None:
        super().__init__(message)
        self.status = status
        self.retryable = retryable
        self.kind = kind  # error | not_found | auth | quota | blocked | recitation | invalid_request | timeout


@dataclass
class GenerateResult:
    text: str
    model: str
    finish_reason: str | None
    prompt_tokens: int = 0
    output_tokens: int = 0
    thought_tokens: int = 0
    latency_ms: int = 0
    raw: dict[str, Any] = field(default_factory=dict)


@dataclass
class EmbedResult:
    vectors: list[list[float]]
    model: str
    input_tokens_estimate: int
    latency_ms: int


@dataclass
class MediaResult:
    """Binary output of an image or speech model (speech is returned as a complete WAV file)."""

    data: bytes
    mime_type: str
    model: str
    prompt_tokens: int = 0
    output_tokens: int = 0
    latency_ms: int = 0
    duration_seconds: float | None = None


def pcm_to_wav(pcm: bytes, sample_rate: int = 24000, channels: int = 1, sample_width: int = 2) -> bytes:
    """Wrap raw little-endian PCM (Gemini TTS returns audio/L16) in a RIFF/WAV container."""
    import io
    import wave

    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(channels)
        w.setsampwidth(sample_width)
        w.setframerate(sample_rate)
        w.writeframes(pcm)
    return buf.getvalue()


def _pcm_format(mime: str) -> tuple[int, int]:
    rate = re.search(r"rate=(\d+)", mime or "")
    ch = re.search(r"channels=(\d+)", mime or "")
    return (int(rate.group(1)) if rate else 24000), (int(ch.group(1)) if ch else 1)


class RateLimiter:
    """Thread-safe sliding-window limiter (requests per minute)."""

    def __init__(self, rpm: int) -> None:
        self.rpm = max(1, rpm)
        self._lock = threading.Lock()
        self._stamps: list[float] = []

    def acquire(self) -> None:
        while True:
            with self._lock:
                now = time.monotonic()
                self._stamps = [t for t in self._stamps if now - t < 60.0]
                if len(self._stamps) < self.rpm:
                    self._stamps.append(now)
                    return
                wait = 60.0 - (now - self._stamps[0]) + 0.05
            time.sleep(min(wait, 5.0))


def _inline_refs(schema: dict[str, Any]) -> dict[str, Any]:
    defs = schema.get("$defs", {})

    def resolve(node: Any, *, property_map: bool = False) -> Any:
        if isinstance(node, dict):
            if property_map:  # keys are field names (a field may be called "title"), values are schemas
                return {name: resolve(sub) for name, sub in node.items()}
            if "$ref" in node:
                name = node["$ref"].split("/")[-1]
                return resolve(copy.deepcopy(defs[name]))
            # drop pydantic's schema metadata ("title") and the definitions that were inlined
            return {k: resolve(v, property_map=k == "properties") for k, v in node.items() if k not in ("$defs", "title")}
        if isinstance(node, list):
            return [resolve(x) for x in node]
        return node

    return resolve(schema)


def to_json_schema(model_cls: Any) -> dict[str, Any]:
    return _inline_refs(model_cls.model_json_schema())


def to_openapi_schema(schema: dict[str, Any]) -> dict[str, Any]:
    """Convert a (ref-inlined) JSON schema to the Gemini OpenAPI subset used by responseSchema."""
    tmap = {"string": "STRING", "number": "NUMBER", "integer": "INTEGER", "boolean": "BOOLEAN", "array": "ARRAY", "object": "OBJECT"}

    def conv(node: dict[str, Any]) -> dict[str, Any]:
        if "anyOf" in node:
            options = [o for o in node["anyOf"] if o.get("type") != "null"]
            nullable = len(options) != len(node["anyOf"])
            out = conv(options[0]) if options else {"type": "STRING"}
            if nullable:
                out["nullable"] = True
            return out
        out: dict[str, Any] = {}
        t = node.get("type")
        if isinstance(t, list):
            non_null = [x for x in t if x != "null"]
            t = non_null[0] if non_null else "string"
            out["nullable"] = True
        if t:
            out["type"] = tmap.get(t, "STRING")
        if "enum" in node:
            out["enum"] = [str(e) for e in node["enum"]]
            out["type"] = "STRING"
        if "description" in node:
            out["description"] = node["description"]
        if t == "object":
            props = node.get("properties", {})
            out["properties"] = {k: conv(v) for k, v in props.items()}
            if node.get("required"):
                out["required"] = list(node["required"])
        if t == "array" and "items" in node:
            out["items"] = conv(node["items"])
        return out

    return conv(schema)


def extract_json(text: str) -> Any:
    text = text.strip()
    fence = re.search(r"```(?:json)?\s*(.*?)```", text, re.DOTALL)
    if fence:
        text = fence.group(1).strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start = min([i for i in (text.find("{"), text.find("[")) if i >= 0], default=-1)
        end = max(text.rfind("}"), text.rfind("]"))
        if start >= 0 and end > start:
            return json.loads(text[start : end + 1])
        raise


def _retry_delay_seconds(payload: dict[str, Any]) -> float | None:
    try:
        for detail in payload.get("error", {}).get("details", []):
            delay = detail.get("retryDelay")
            if delay and delay.endswith("s"):
                return float(delay[:-1])
    except Exception:  # noqa: BLE001
        return None
    return None


class GeminiClient:
    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or get_settings()
        self.base_url = self.settings.gemini_base_url.rstrip("/")
        self.limiter = RateLimiter(self.settings.gemini_max_rpm)
        self._http = httpx.Client(timeout=httpx.Timeout(self.settings.gemini_timeout_seconds, connect=15.0))
        self._resolved: dict[str, str] = {}
        self._schema_mode: dict[str, str] = {}  # model -> json | openapi | none
        self._versions: dict[str, str] = {}  # requested model/alias -> modelVersion reported by the API
        self._no_thinking_config: set[str] = set()
        self._config_embed_fields: set[str] = set()
        self._warned_embed_dims: set[str] = set()
        self._no_image_config: set[str] = set()
        self._lock = threading.Lock()

    @property
    def configured(self) -> bool:
        return bool(self.settings.gemini_api_key.strip())

    def _headers(self) -> dict[str, str]:
        return {"x-goog-api-key": self.settings.gemini_api_key.strip(), "Content-Type": "application/json"}

    # ------------------------------------------------------------------ http
    def _post(self, path: str, body: dict[str, Any], max_attempts: int = 5) -> dict[str, Any]:
        if not self.configured:
            raise GeminiError("GEMINI_API_KEY is not configured", kind="auth")
        url = f"{self.base_url}/{path}"
        last: GeminiError | None = None
        for attempt in range(1, max_attempts + 1):
            self.limiter.acquire()
            try:
                resp = self._http.post(url, headers=self._headers(), json=body)
            except httpx.TimeoutException as exc:
                last = GeminiError(f"timeout calling Gemini: {exc}", retryable=True, kind="timeout")
            except httpx.HTTPError as exc:
                last = GeminiError(f"network error calling Gemini: {exc}", retryable=True)
            else:
                if resp.status_code == 200:
                    return resp.json()
                try:
                    payload = resp.json()
                except ValueError:
                    payload = {"error": {"message": resp.text[:500]}}
                message = payload.get("error", {}).get("message", resp.text[:300])
                status = resp.status_code
                if status == 404:
                    raise GeminiError(message, status, kind="not_found")
                if status in (401, 403):
                    raise GeminiError(message, status, kind="auth")
                if status == 400:
                    raise GeminiError(message, status, kind="invalid_request")
                if status == 429:
                    delay = _retry_delay_seconds(payload)
                    last = GeminiError(message, status, retryable=True, kind="quota")
                    if "per day" in message.lower() or "daily" in message.lower():
                        raise last
                    time.sleep(min(60.0, delay if delay is not None else 2 ** attempt + random.random()))
                    continue
                last = GeminiError(message, status, retryable=status >= 500)
                if not last.retryable:
                    raise last
            if attempt < max_attempts:
                time.sleep(min(30.0, (2 ** attempt) * 0.75 + random.random()))
        assert last is not None
        raise last

    def _get(self, path: str) -> dict[str, Any]:
        if not self.configured:
            raise GeminiError("GEMINI_API_KEY is not configured", kind="auth")
        resp = self._http.get(f"{self.base_url}/{path}", headers=self._headers())
        if resp.status_code != 200:
            raise GeminiError(resp.text[:300], resp.status_code, kind="auth" if resp.status_code in (401, 403) else "error")
        return resp.json()

    # ------------------------------------------------------------------ models
    def list_models(self) -> list[dict[str, Any]]:
        models: list[dict[str, Any]] = []
        token = ""
        for _ in range(10):
            data = self._get(f"models?pageSize=1000{('&pageToken=' + token) if token else ''}")
            models.extend(data.get("models", []))
            token = data.get("nextPageToken", "")
            if not token:
                break
        return models

    def _candidates(self, model: str) -> list[str]:
        seen: list[str] = []
        for m in [self._resolved.get(model, model), model, *self.settings.model_fallback_list]:
            if m and m not in seen:
                seen.append(m)
        return seen

    # ------------------------------------------------------------------ generate
    def generate(
        self,
        model: str,
        system: str,
        parts: list[dict[str, Any]],
        *,
        temperature: float = 0.1,
        json_schema: dict[str, Any] | None = None,
        max_output_tokens: int = 16384,
        prompt_id: str = "",
        generation_overrides: dict[str, Any] | None = None,
    ) -> GenerateResult:
        errors: list[str] = []
        for candidate in self._candidates(model):
            try:
                result = self._generate_once(candidate, system, parts, temperature, json_schema, max_output_tokens, generation_overrides)
                if candidate != model:
                    self._resolved[model] = candidate
                return result
            except GeminiError as exc:
                if exc.kind == "not_found" or (exc.kind == "invalid_request" and "model" in str(exc).lower() and "not" in str(exc).lower()):
                    errors.append(f"{candidate}: {exc}")
                    continue
                raise
        raise GeminiError("no usable Gemini model: " + " | ".join(errors), kind="not_found")

    def _is_gemini3(self, model: str) -> bool:
        """Gemini 3+ models take thinkingLevel and are tuned for their default temperature."""
        name = self._versions.get(model) or model
        major = re.search(r"gemini-(\d+)", name)
        if major:
            return int(major.group(1)) >= 3
        # "-latest" aliases track the current generation; learnt from modelVersion after the first call, and a
        # rejected thinkingLevel falls back without it
        return name.endswith("-latest")

    def _generate_once(self, model, system, parts, temperature, json_schema, max_output_tokens, generation_overrides=None) -> GenerateResult:
        mode = self._schema_mode.get(model, "json") if json_schema else "none"
        while True:
            gen_cfg: dict[str, Any] = {"maxOutputTokens": max_output_tokens, **(generation_overrides or {})}
            gemini3 = self._is_gemini3(model)
            if not gemini3:
                # Gemini 3 models are tuned for their default temperature (1.0); older models get low temperatures for extraction.
                gen_cfg["temperature"] = temperature
            if json_schema is not None:
                gen_cfg["responseMimeType"] = "application/json"
                if mode == "json":
                    gen_cfg["responseJsonSchema"] = json_schema
                elif mode == "openapi":
                    gen_cfg["responseSchema"] = to_openapi_schema(json_schema)
            if model not in self._no_thinking_config:
                if self.settings.gemini_thinking_budget is not None:
                    gen_cfg["thinkingConfig"] = {"thinkingBudget": self.settings.gemini_thinking_budget}
                elif gemini3 and self.settings.gemini_thinking_level:
                    gen_cfg["thinkingConfig"] = {"thinkingLevel": self.settings.gemini_thinking_level.strip().upper()}
            body: dict[str, Any] = {
                "contents": [{"role": "user", "parts": parts}],
                "generationConfig": gen_cfg,
                "safetySettings": [
                    {"category": c, "threshold": "BLOCK_ONLY_HIGH"}
                    for c in ("HARM_CATEGORY_HARASSMENT", "HARM_CATEGORY_HATE_SPEECH", "HARM_CATEGORY_SEXUALLY_EXPLICIT", "HARM_CATEGORY_DANGEROUS_CONTENT")
                ],
            }
            if system:
                body["systemInstruction"] = {"parts": [{"text": system}]}
            t0 = time.monotonic()
            try:
                data = self._post(f"models/{model}:generateContent", body)
            except GeminiError as exc:
                msg = str(exc).lower()
                if exc.kind == "invalid_request" and "thinking" in msg and "thinkingConfig" in gen_cfg:
                    self._no_thinking_config.add(model)
                    continue
                schema_problem = exc.kind == "invalid_request" and (
                    "schema" in msg or "response_json_schema" in msg or "responsejsonschema" in msg or "unknown name" in msg
                )
                if schema_problem and mode == "json":
                    mode = "openapi"
                    self._schema_mode[model] = mode
                    continue
                if schema_problem and mode == "openapi":
                    mode = "none"
                    self._schema_mode[model] = mode
                    continue
                raise
            latency = int((time.monotonic() - t0) * 1000)
            if data.get("modelVersion"):
                self._versions[model] = str(data["modelVersion"])
            feedback = data.get("promptFeedback", {})
            if feedback.get("blockReason"):
                raise GeminiError(f"prompt blocked: {feedback.get('blockReason')}", kind="blocked")
            candidates = data.get("candidates") or []
            if not candidates:
                raise GeminiError("empty response from Gemini", retryable=True)
            cand = candidates[0]
            finish = cand.get("finishReason")
            texts = [p.get("text", "") for p in cand.get("content", {}).get("parts", []) if not p.get("thought")]
            text = "".join(texts).strip()
            usage = data.get("usageMetadata", {})
            if finish in ("SAFETY", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII") and not text:
                raise GeminiError(f"response blocked ({finish})", kind="blocked")
            if finish == "RECITATION" and not text:
                raise GeminiError("response stopped for recitation", kind="recitation", retryable=True)
            if not text:
                raise GeminiError(f"no text in response (finishReason={finish})", retryable=True)
            return GenerateResult(
                text=text, model=data.get("modelVersion") or model, finish_reason=finish,
                prompt_tokens=int(usage.get("promptTokenCount", 0) or 0),
                output_tokens=int(usage.get("candidatesTokenCount", 0) or 0),
                thought_tokens=int(usage.get("thoughtsTokenCount", 0) or 0), latency_ms=latency, raw={"finishReason": finish},
            )

    # ------------------------------------------------------------------ embeddings
    def embed(self, model: str, texts: list[str], task_type: str, dims: int) -> EmbedResult:
        t0 = time.monotonic()
        vectors: list[list[float]] = []
        tokens = 0
        for i in range(0, len(texts), 100):
            batch = texts[i : i + 100]
            # Request-level taskType/outputDimensionality are what the live batchEmbedContents endpoint honours
            # (verified: a nested embedContentConfig is accepted but silently ignored there). The nested form is
            # only used if an API version rejects the request-level fields.
            nested = model in self._config_embed_fields

            def request(text: str) -> dict[str, Any]:
                base: dict[str, Any] = {"model": f"models/{model}", "content": {"parts": [{"text": text[:8000]}]}}
                if nested:
                    base["embedContentConfig"] = {"taskType": task_type, "outputDimensionality": dims, "autoTruncate": True}
                else:
                    base.update(taskType=task_type, outputDimensionality=dims)
                return base

            try:
                data = self._post(f"models/{model}:batchEmbedContents", {"requests": [request(t) for t in batch]})
            except GeminiError as exc:
                msg = str(exc).lower()
                if not nested and exc.kind == "invalid_request" and "unknown name" in msg and ("tasktype" in msg.replace("_", "") or "outputdimensionality" in msg.replace("_", "")):
                    self._config_embed_fields.add(model)
                    nested = True
                    data = self._post(f"models/{model}:batchEmbedContents", {"requests": [request(t) for t in batch]})
                else:
                    raise
            got = [e.get("values", []) for e in data.get("embeddings", [])]
            if len(got) != len(batch) or any(len(v) < dims for v in got):
                raise GeminiError(f"unexpected embedding response shape ({len(got)} vectors for {len(batch)} inputs)")
            if any(len(v) != dims for v in got) and model not in self._warned_embed_dims:
                self._warned_embed_dims.add(model)
                log.warning("%s returned %d-dim embeddings for outputDimensionality=%d; the request options may be ignored", model, len(got[0]), dims)
            # Matryoshka embeddings: if the model ignored the requested size, truncating keeps them valid (re-normalised later)
            vectors.extend(v[:dims] for v in got)
            usage = data.get("usageMetadata") or {}
            tokens += int(usage.get("promptTokenCount") or 0) or sum(len(t) for t in batch) // 4
        return EmbedResult(vectors, model, tokens, int((time.monotonic() - t0) * 1000))

    # ------------------------------------------------------------------ images + speech
    def _media_call(self, models: list[str], build_body: Any, expect: str) -> tuple[dict[str, Any], str, int]:
        """POST generateContent to the first model in ``models`` that exists; returns (response, model, latency_ms)."""
        errors: list[str] = []
        for model in [m for i, m in enumerate(models) if m and m not in models[:i]]:
            body = build_body(model)
            t0 = time.monotonic()
            try:
                data = self._post(f"models/{model}:generateContent", body, max_attempts=4)
            except GeminiError as exc:
                msg = str(exc).lower()
                if exc.kind == "invalid_request" and expect == "image" and "imageconfig" in msg.replace("_", "") and model not in self._no_image_config:
                    self._no_image_config.add(model)  # model rejects aspect/size hints: retry it without them
                    try:
                        data = self._post(f"models/{model}:generateContent", build_body(model), max_attempts=4)
                    except GeminiError as exc2:
                        errors.append(f"{model}: {exc2}")
                        continue
                elif exc.kind in ("not_found", "invalid_request") or (exc.kind == "error" and exc.status in (500, 503)):
                    errors.append(f"{model}: {exc}")
                    continue
                else:
                    raise
            feedback = data.get("promptFeedback", {})
            if feedback.get("blockReason"):
                raise GeminiError(f"prompt blocked: {feedback.get('blockReason')}", kind="blocked")
            return data, model, int((time.monotonic() - t0) * 1000)
        raise GeminiError("no usable Gemini model: " + " | ".join(errors), kind="not_found")

    @staticmethod
    def _inline(data: dict[str, Any], prefix: str) -> tuple[bytes, str] | None:
        import base64

        for cand in data.get("candidates") or []:
            for part in cand.get("content", {}).get("parts", []) or []:
                inline = part.get("inlineData") or part.get("inline_data")
                mime = (inline or {}).get("mimeType") or (inline or {}).get("mime_type") or ""
                if inline and inline.get("data") and mime.lower().startswith(prefix):
                    return base64.b64decode(inline["data"]), mime
        return None

    def generate_image(self, prompt: str, models: list[str], *, aspect_ratio: str | None = "16:9", image_size: str | None = "1K") -> MediaResult:
        def body(model: str) -> dict[str, Any]:
            cfg: dict[str, Any] = {"responseModalities": ["IMAGE"]}
            image_cfg = {k: v for k, v in (("aspectRatio", aspect_ratio), ("imageSize", image_size)) if v}
            if image_cfg and model not in self._no_image_config:
                cfg["imageConfig"] = image_cfg
            return {"contents": [{"role": "user", "parts": [{"text": prompt}]}], "generationConfig": cfg}

        data, model, latency = self._media_call(models, body, "image")
        found = self._inline(data, "image/")
        if not found:
            finish = ((data.get("candidates") or [{}])[0]).get("finishReason")
            raise GeminiError(f"the image model returned no image (finishReason={finish})", retryable=True, kind="no_media")
        usage = data.get("usageMetadata", {})
        return MediaResult(found[0], found[1], data.get("modelVersion") or model, int(usage.get("promptTokenCount", 0) or 0),
                           int(usage.get("candidatesTokenCount", 0) or 0), latency)

    def synthesize_speech(self, text: str, models: list[str], *, voice: str = "Kore", style: str = "") -> MediaResult:
        spoken = f"{style.strip()}:\n\n{text}" if style.strip() else text

        def body(model: str) -> dict[str, Any]:
            return {
                "contents": [{"role": "user", "parts": [{"text": spoken}]}],
                "generationConfig": {"responseModalities": ["AUDIO"], "speechConfig": {"voiceConfig": {"prebuiltVoiceConfig": {"voiceName": voice}}}},
            }

        data, model, latency = self._media_call(models, body, "audio")
        found = self._inline(data, "audio/")
        if not found:
            finish = ((data.get("candidates") or [{}])[0]).get("finishReason")
            raise GeminiError(f"the speech model returned no audio (finishReason={finish})", retryable=True, kind="no_media")
        raw, mime = found
        if raw[:4] == b"RIFF":
            wav = raw
            duration = None
        else:  # audio/L16;rate=24000 PCM
            rate, channels = _pcm_format(mime)
            wav = pcm_to_wav(raw, rate, channels)
            duration = len(raw) / (rate * channels * 2)
        usage = data.get("usageMetadata", {})
        return MediaResult(wav, "audio/wav", data.get("modelVersion") or model, int(usage.get("promptTokenCount", 0) or 0),
                           int(usage.get("candidatesTokenCount", 0) or 0), latency, duration)


_CLIENT: GeminiClient | None = None
_CLIENT_LOCK = threading.Lock()


def get_gemini_client() -> GeminiClient:
    global _CLIENT
    with _CLIENT_LOCK:
        if _CLIENT is None:
            _CLIENT = GeminiClient()
        return _CLIENT

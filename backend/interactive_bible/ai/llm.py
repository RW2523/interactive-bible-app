"""LLM service: prompt rendering, schema validation + retry, caching, cost/budget accounting, call log.

Pipeline code calls ``get_llm()``; tests install a fake client with ``set_llm_client``.
"""
from __future__ import annotations

import base64
import hashlib
import json
import logging
import threading
from dataclasses import dataclass
from typing import Any, Generic, Protocol, TypeVar

from pydantic import BaseModel, ValidationError

from ..config import get_settings
from ..db import execute, fetch_one, session_scope
from .gemini import EmbedResult, GeminiError, GenerateResult, MediaResult, extract_json, get_gemini_client, to_json_schema
from .prompt_pack import Prompt, get_prompt

log = logging.getLogger(__name__)
T = TypeVar("T", bound=BaseModel)


class AIUnavailable(Exception):
    """AI is not configured, over budget or the provider failed - callers degrade gracefully."""


class AIInvalidOutput(Exception):
    """The model returned output that failed schema validation twice."""


class GenClient(Protocol):
    configured: bool

    def generate(self, model: str, system: str, parts: list[dict[str, Any]], *, temperature: float = 0.1,
                 json_schema: dict[str, Any] | None = None, max_output_tokens: int = 16384, prompt_id: str = "") -> GenerateResult: ...

    def embed(self, model: str, texts: list[str], task_type: str, dims: int) -> EmbedResult: ...

    def generate_image(self, prompt: str, models: list[str], *, aspect_ratio: str | None = "16:9", image_size: str | None = "1K") -> MediaResult: ...

    def synthesize_speech(self, text: str, models: list[str], *, voice: str = "Kore", style: str = "") -> MediaResult: ...


@dataclass
class LLMResult(Generic[T]):
    output: T
    model: str
    prompt_id: str
    prompt_version: str
    cached: bool
    prompt_tokens: int = 0
    output_tokens: int = 0

    def provenance(self) -> dict[str, Any]:
        return {"prompt_id": self.prompt_id, "prompt_version": self.prompt_version, "model": self.model, "cached": self.cached}


class LLMService:
    def __init__(self, client: GenClient | None = None) -> None:
        self._client = client
        self._budget_lock = threading.Lock()

    @property
    def client(self) -> GenClient:
        return self._client or get_gemini_client()

    @property
    def available(self) -> bool:
        try:
            return bool(self.client.configured)
        except Exception:  # noqa: BLE001
            return False

    def model_for(self, prompt: Prompt) -> str:
        s = get_settings()
        return {"transcribe": s.gemini_model_transcribe, "fast": s.gemini_model_fast}.get(prompt.role, s.gemini_model_analysis)

    # ------------------------------------------------------------------ budget / logging
    def _tokens_today(self) -> int:
        with session_scope() as session:
            row = fetch_one(session, "SELECT coalesce(sum(prompt_tokens + output_tokens + thought_tokens), 0) AS n FROM llm_calls WHERE created_at >= date_trunc('day', now()) AND NOT cached")
        return int(row["n"]) if row else 0

    def _check_budget(self) -> None:
        budget = get_settings().gemini_daily_token_budget
        if budget and self._tokens_today() >= budget:
            raise AIUnavailable(f"daily Gemini token budget ({budget}) exhausted")

    @staticmethod
    def _cost(prompt_tokens: int, output_tokens: int, thought_tokens: int) -> float:
        s = get_settings()
        return round(prompt_tokens / 1e6 * s.gemini_price_input_per_mtok + (output_tokens + thought_tokens) / 1e6 * s.gemini_price_output_per_mtok, 6)

    def _log(self, **fields: Any) -> None:
        try:
            with session_scope() as session:
                execute(
                    session,
                    """INSERT INTO llm_calls (prompt_id, prompt_version, model, input_hash, status, cached, latency_ms,
                           prompt_tokens, output_tokens, thought_tokens, cost_usd, error, resource_id, run_id)
                       VALUES (:prompt_id, :prompt_version, :model, :input_hash, :status, :cached, :latency_ms,
                           :prompt_tokens, :output_tokens, :thought_tokens, :cost_usd, :error, :resource_id, :run_id)""",
                    **{
                        "latency_ms": None, "prompt_tokens": 0, "output_tokens": 0, "thought_tokens": 0, "cost_usd": 0,
                        "error": None, "resource_id": None, "run_id": None, "cached": False, **fields,
                    },
                )
        except Exception:  # noqa: BLE001 - logging must never break the pipeline
            log.exception("failed to log llm call")

    # ------------------------------------------------------------------ generate
    def run(
        self,
        prompt_id: str,
        variables: dict[str, Any],
        schema: type[T],
        *,
        media_parts: list[dict[str, Any]] | None = None,
        resource_id: str | None = None,
        run_id: str | None = None,
        use_cache: bool = True,
        cache_salt: str = "",
        generation_overrides: dict[str, Any] | None = None,
        cache_only: bool = False,
    ) -> LLMResult[T]:
        """cache_only=True returns a previously generated result (no key needed) or raises AIUnavailable - never calls the model."""
        if not self.available and not cache_only:
            raise AIUnavailable("GEMINI_API_KEY is not configured")
        prompt = get_prompt(prompt_id)
        model = self.model_for(prompt)
        user_text = prompt.render(variables)
        media_digest = ""
        if media_parts:
            h = hashlib.sha256()
            for p in media_parts:
                h.update(json.dumps(p, sort_keys=True)[:200].encode())
                data = p.get("inlineData", {}).get("data")
                if data:
                    h.update(hashlib.sha256(data.encode()).digest())
            media_digest = h.hexdigest()
        input_hash = hashlib.sha256(f"{prompt.system}\n{user_text}\n{media_digest}\n{cache_salt}".encode()).hexdigest()
        cache_key = f"{prompt_id}:{prompt.version}:{model}:{input_hash}"

        if use_cache:
            with session_scope() as session:
                hit = fetch_one(session, "SELECT output, model FROM llm_cache WHERE cache_key = :k", k=cache_key)
            if hit:
                try:
                    parsed = schema.model_validate(hit["output"])
                    self._log(prompt_id=prompt_id, prompt_version=prompt.version, model=hit["model"], input_hash=input_hash, status="cached", cached=True, resource_id=resource_id, run_id=run_id)
                    return LLMResult(parsed, hit["model"], prompt_id, prompt.version, True)
                except ValidationError:
                    pass
        if cache_only:
            raise AIUnavailable(f"{prompt_id}: no cached result yet")

        with self._budget_lock:
            self._check_budget()

        json_schema = to_json_schema(schema)
        parts: list[dict[str, Any]] = [*(media_parts or []), {"text": user_text}]
        attempts = 0
        last_error = ""
        total_in = total_out = 0
        while attempts < 2:
            attempts += 1
            try:
                extra = {"generation_overrides": generation_overrides} if generation_overrides else {}
                result = self.client.generate(
                    model, prompt.system, parts, temperature=prompt.temperature, json_schema=json_schema,
                    max_output_tokens=prompt.max_output_tokens, prompt_id=prompt_id, **extra,
                )
            except GeminiError as exc:
                self._log(prompt_id=prompt_id, prompt_version=prompt.version, model=model, input_hash=input_hash, status=f"error:{exc.kind}", error=str(exc)[:500], resource_id=resource_id, run_id=run_id)
                if exc.kind == "recitation" and attempts < 2:
                    continue
                raise AIUnavailable(f"Gemini call failed for {prompt_id}: {exc}") from exc
            except Exception as exc:  # noqa: BLE001 - fail safe: unexpected client/transport errors degrade instead of crashing
                log.exception("unexpected error calling the model for %s", prompt_id)
                self._log(prompt_id=prompt_id, prompt_version=prompt.version, model=model, input_hash=input_hash, status="error:unexpected", error=f"{type(exc).__name__}: {exc}"[:500], resource_id=resource_id, run_id=run_id)
                raise AIUnavailable(f"model call failed for {prompt_id}: {type(exc).__name__}") from exc
            total_in += result.prompt_tokens
            total_out += result.output_tokens + result.thought_tokens
            cost = self._cost(result.prompt_tokens, result.output_tokens, result.thought_tokens)
            try:
                data = extract_json(result.text)
                parsed = schema.model_validate(data)
            except (ValueError, ValidationError) as exc:
                last_error = str(exc)[:800]
                self._log(prompt_id=prompt_id, prompt_version=prompt.version, model=result.model, input_hash=input_hash, status="invalid_json", latency_ms=result.latency_ms, prompt_tokens=result.prompt_tokens, output_tokens=result.output_tokens, thought_tokens=result.thought_tokens, cost_usd=cost, error=last_error, resource_id=resource_id, run_id=run_id)
                parts = [*(media_parts or []), {"text": user_text + f"\n\nYOUR PREVIOUS OUTPUT WAS INVALID ({last_error[:300]}). Return ONLY valid JSON that matches the OUTPUT SCHEMA."}]
                continue
            self._log(prompt_id=prompt_id, prompt_version=prompt.version, model=result.model, input_hash=input_hash, status="ok", latency_ms=result.latency_ms, prompt_tokens=result.prompt_tokens, output_tokens=result.output_tokens, thought_tokens=result.thought_tokens, cost_usd=cost, resource_id=resource_id, run_id=run_id)
            if use_cache:
                with session_scope() as session:
                    execute(
                        session,
                        """INSERT INTO llm_cache (cache_key, prompt_id, prompt_version, model, output)
                           VALUES (:k, :p, :v, :m, CAST(:o AS jsonb)) ON CONFLICT (cache_key) DO NOTHING""",
                        k=cache_key, p=prompt_id, v=prompt.version, m=result.model, o=parsed.model_dump_json(),
                    )
            return LLMResult(parsed, result.model, prompt_id, prompt.version, False, total_in, total_out)
        raise AIInvalidOutput(f"{prompt_id} returned invalid JSON twice: {last_error}")

    # ------------------------------------------------------------------ embeddings
    def embed(self, texts: list[str], task_type: str = "RETRIEVAL_DOCUMENT", run_id: str | None = None) -> tuple[list[list[float]], str]:
        if not self.available:
            raise AIUnavailable("GEMINI_API_KEY is not configured")
        if not texts:
            return [], get_settings().gemini_embed_model
        s = get_settings()
        with self._budget_lock:
            self._check_budget()
        try:
            res = self.client.embed(s.gemini_embed_model, texts, task_type, s.embedding_dim)
        except GeminiError as exc:
            self._log(prompt_id="EMBED", prompt_version=task_type, model=s.gemini_embed_model, input_hash="-", status=f"error:{exc.kind}", error=str(exc)[:500], run_id=run_id)
            raise AIUnavailable(f"Gemini embedding failed: {exc}") from exc
        cost = round(res.input_tokens_estimate / 1e6 * s.gemini_price_embed_per_mtok, 6)
        self._log(prompt_id="EMBED", prompt_version=task_type, model=res.model, input_hash=str(len(texts)), status="ok", latency_ms=res.latency_ms, prompt_tokens=res.input_tokens_estimate, cost_usd=cost, run_id=run_id)
        return [_normalise(v) for v in res.vectors], res.model

    # ------------------------------------------------------------------ images + speech
    def image(self, prompt: str, purpose: str, *, high_quality: bool = False, aspect_ratio: str | None = "16:9",
              image_size: str | None = "1K", run_id: str | None = None) -> MediaResult:
        """Generate one image. ``purpose`` (e.g. ``IMG:sermon``) is recorded in the call log."""
        if not self.available:
            raise AIUnavailable("GEMINI_API_KEY is not configured")
        s = get_settings()
        with self._budget_lock:
            self._check_budget()
        digest = hashlib.sha256(prompt.encode()).hexdigest()
        try:
            res = self.client.generate_image(prompt, s.image_models(high_quality), aspect_ratio=aspect_ratio, image_size=image_size)
        except GeminiError as exc:
            self._log(prompt_id=purpose, prompt_version="image", model=s.gemini_image_model, input_hash=digest, status=f"error:{exc.kind}", error=str(exc)[:500], run_id=run_id)
            raise AIUnavailable(f"image generation failed: {exc}") from exc
        except Exception as exc:  # noqa: BLE001
            log.exception("unexpected image generation error")
            raise AIUnavailable(f"image generation failed: {type(exc).__name__}") from exc
        cost = round(res.prompt_tokens / 1e6 * s.gemini_price_input_per_mtok + res.output_tokens / 1e6 * s.gemini_price_image_output_per_mtok, 6)
        self._log(prompt_id=purpose, prompt_version="image", model=res.model, input_hash=digest, status="ok", latency_ms=res.latency_ms,
                  prompt_tokens=res.prompt_tokens, output_tokens=res.output_tokens, cost_usd=cost, run_id=run_id)
        return res

    def speech(self, text: str, purpose: str, *, voice: str | None = None, style: str = "", run_id: str | None = None) -> MediaResult:
        """Narrate ``text``; returns a WAV file."""
        if not self.available:
            raise AIUnavailable("GEMINI_API_KEY is not configured")
        s = get_settings()
        with self._budget_lock:
            self._check_budget()
        digest = hashlib.sha256(f"{voice}|{style}|{text}".encode()).hexdigest()
        try:
            res = self.client.synthesize_speech(text, s.tts_models, voice=voice or s.gemini_tts_voice, style=style)
        except GeminiError as exc:
            self._log(prompt_id=purpose, prompt_version="speech", model=s.gemini_tts_model, input_hash=digest, status=f"error:{exc.kind}", error=str(exc)[:500], run_id=run_id)
            raise AIUnavailable(f"narration failed: {exc}") from exc
        except Exception as exc:  # noqa: BLE001
            log.exception("unexpected speech generation error")
            raise AIUnavailable(f"narration failed: {type(exc).__name__}") from exc
        cost = round(res.prompt_tokens / 1e6 * s.gemini_price_input_per_mtok + res.output_tokens / 1e6 * s.gemini_price_tts_output_per_mtok, 6)
        self._log(prompt_id=purpose, prompt_version="speech", model=res.model, input_hash=digest, status="ok", latency_ms=res.latency_ms,
                  prompt_tokens=res.prompt_tokens, output_tokens=res.output_tokens, cost_usd=cost, run_id=run_id)
        return res


def _normalise(v: list[float]) -> list[float]:
    norm = sum(x * x for x in v) ** 0.5
    return [x / norm for x in v] if norm else v


def audio_part(data: bytes, mime_type: str) -> dict[str, Any]:
    return {"inlineData": {"mimeType": mime_type, "data": base64.b64encode(data).decode()}}


_LLM: LLMService | None = None
_LOCK = threading.Lock()


def get_llm() -> LLMService:
    global _LLM
    with _LOCK:
        if _LLM is None:
            _LLM = LLMService()
        return _LLM


def set_llm_client(client: GenClient | None) -> LLMService:
    """Install a custom (e.g. fake) client - used by tests and the offline evaluation harness."""
    global _LLM
    with _LOCK:
        _LLM = LLMService(client)
        return _LLM

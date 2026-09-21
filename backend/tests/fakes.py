"""Deterministic, offline stand-ins for the Gemini client used by ``interactive_bible.ai.llm``.

``FakeGeminiClient`` implements the ``GenClient`` protocol (``configured``, ``generate`` and
``embed``). It dispatches on the ``prompt_id`` keyword, parses the rendered user prompt
(``parts[-1]["text"]``) and returns plausible, schema-valid JSON for every prompt P-00..P-15.
Tests override single prompts with ``fake.on(prompt_id, handler_or_value)`` or queue one-off
responses with ``fake.queue(prompt_id, *responses)`` (handy for invalid-JSON retries).
"""
from __future__ import annotations

import hashlib
import json
import re
import threading
from dataclasses import dataclass, field
from typing import Any, Callable

import numpy as np

from interactive_bible.ai.gemini import EmbedResult, GenerateResult, MediaResult, pcm_to_wav

WORD = re.compile(r"[A-Za-z']+")


def tiny_png(seed_text: str) -> bytes:
    """A valid 2x2 PNG whose colour is derived from ``seed_text``."""
    import struct
    import zlib

    rgb = hashlib.sha256(seed_text.encode()).digest()[:3]
    raw = b"\x00" + rgb * 2 + b"\x00" + rgb * 2  # one filter byte per row

    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 2, 2, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")


ALL_PROMPTS = [f"P-{i:02d}" for i in range(16)]


class UnconfiguredClient:
    """Simulates a server without GEMINI_API_KEY: every caller must degrade gracefully."""

    configured = False

    def generate(self, *args: Any, **kwargs: Any) -> GenerateResult:  # pragma: no cover - must never be called
        raise AssertionError("an unconfigured LLM client must never be called")

    def embed(self, *args: Any, **kwargs: Any) -> EmbedResult:  # pragma: no cover - must never be called
        raise AssertionError("an unconfigured LLM client must never be called")

    def generate_image(self, *args: Any, **kwargs: Any) -> MediaResult:  # pragma: no cover - must never be called
        raise AssertionError("an unconfigured LLM client must never be called")

    def synthesize_speech(self, *args: Any, **kwargs: Any) -> MediaResult:  # pragma: no cover - must never be called
        raise AssertionError("an unconfigured LLM client must never be called")


@dataclass
class FakeCall:
    prompt_id: str
    model: str
    system: str
    parts: list[dict[str, Any]]
    text: str
    options: dict[str, Any] = field(default_factory=dict)  # temperature, json_schema, generation_overrides, ...

    # ------------------------------------------------------------------ prompt parsing helpers
    def section(self, label: str) -> str:
        """Text between ``<label>...:\\n<<<\\n`` and ``\\n>>>`` (first occurrence)."""
        m = re.search(rf"(?m)^{re.escape(label)}[^\n]*:\s*\n<<<\n(.*?)\n>>>", self.text, re.S)
        return m.group(1) if m else ""

    def line(self, label: str) -> str:
        m = re.search(rf"(?m)^{re.escape(label)}:[ \t]*(.*)$", self.text)
        return m.group(1).strip() if m else ""

    def json_line(self, label: str) -> Any:
        """JSON value rendered on the line that starts with ``label:`` (or on the line after a header)."""
        raw = self.line(label)
        if not raw:
            m = re.search(rf"(?m)^{re.escape(label)}[^\n]*:[ \t]*\n(.*)$", self.text)
            raw = m.group(1).strip() if m else ""
        if not raw:
            return None
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return raw


Handler = Callable[[FakeCall], Any]


def words(text: str) -> set[str]:
    return {w.lower().strip("'") for w in WORD.findall(text or "") if len(w) > 2}


def sentences(text: str) -> list[str]:
    return [s.strip() for s in re.findall(r"[^.!?\n]+[.!?]?", text or "") if s.strip()]


def best_sentence(segment: str, verse_text: str) -> str:
    """The segment sentence sharing the most words with a verse (copied verbatim: always grounded)."""
    target = words(verse_text)
    options = sentences(segment)
    if not options:
        return segment[:200]
    return max(options, key=lambda s: (len(words(s) & target), -len(s)))


@dataclass
class FakeGeminiClient:
    configured: bool = True
    calls: list[FakeCall] = field(default_factory=list)
    embed_calls: list[tuple[str, list[str], str, int]] = field(default_factory=list)
    handlers: dict[str, Handler] = field(default_factory=dict)
    queued: dict[str, list[Any]] = field(default_factory=dict)
    image_calls: list[tuple] = field(default_factory=list)
    speech_calls: list[tuple] = field(default_factory=list)
    image_failures: list[Exception] = field(default_factory=list)  # raised by the next generate_image calls, in order

    def __post_init__(self) -> None:
        self._lock = threading.Lock()

    # ------------------------------------------------------------------ configuration
    def on(self, prompt_id: str, handler: Handler | Any) -> "FakeGeminiClient":
        """Install a handler (callable receiving FakeCall) or a constant response for a prompt."""
        self.handlers[prompt_id] = handler if callable(handler) else (lambda _call, _value=handler: _value)
        return self

    def queue(self, prompt_id: str, *responses: Any) -> "FakeGeminiClient":
        """One-off responses consumed before the handler (str responses are returned verbatim)."""
        with self._lock:
            self.queued.setdefault(prompt_id, []).extend(responses)
        return self

    def prompt_ids(self) -> list[str]:
        with self._lock:
            return [c.prompt_id for c in self.calls]

    def calls_for(self, prompt_id: str) -> list[FakeCall]:
        with self._lock:
            return [c for c in self.calls if c.prompt_id == prompt_id]

    # ------------------------------------------------------------------ GenClient protocol
    def generate(self, model: str, system: str, parts: list[dict[str, Any]], *, temperature: float = 0.1,
                 json_schema: dict[str, Any] | None = None, max_output_tokens: int = 16384, prompt_id: str = "",
                 generation_overrides: dict[str, Any] | None = None, **extra: Any) -> GenerateResult:
        text = parts[-1].get("text", "") if parts else ""
        options = {"temperature": temperature, "json_schema": json_schema, "max_output_tokens": max_output_tokens,
                   "generation_overrides": generation_overrides, **extra}
        call = FakeCall(prompt_id, model, system, parts, text, options)
        with self._lock:
            self.calls.append(call)
            pending = self.queued.get(prompt_id)
            response = pending.pop(0) if pending else None
            has_queued = response is not None
        if not has_queued:
            handler = self.handlers.get(prompt_id) or getattr(self, "default_" + prompt_id.replace("-", "_"), None)
            if handler is None:
                raise AssertionError(f"FakeGeminiClient has no handler for {prompt_id!r}")
            response = handler(call)
        out = response if isinstance(response, str) else json.dumps(response)
        return GenerateResult(text=out, model=model, finish_reason="STOP", prompt_tokens=max(1, len(text) // 4),
                              output_tokens=max(1, len(out) // 4), latency_ms=1, raw={"fake": True})

    def generate_image(self, prompt: str, models: list[str], *, aspect_ratio: str | None = "16:9", image_size: str | None = "1K") -> MediaResult:
        """A real (tiny) PNG whose colour depends on the prompt, so different prompts give different files."""
        with self._lock:
            self.image_calls.append((prompt, list(models), aspect_ratio, image_size))
            failure = self.image_failures.pop(0) if self.image_failures else None
        if failure:
            raise failure
        return MediaResult(tiny_png(prompt), "image/png", models[0] if models else "fake-image", 10, 1290, 1)

    def synthesize_speech(self, text: str, models: list[str], *, voice: str = "Kore", style: str = "") -> MediaResult:
        with self._lock:
            self.speech_calls.append((text, list(models), voice, style))
        seconds = max(1.0, min(30.0, len(text.split()) / 2.5))
        pcm = b"\x00\x00" * int(24000 * seconds)
        return MediaResult(pcm_to_wav(pcm), "audio/wav", models[0] if models else "fake-tts", 10, 100, 1, seconds)

    def embed(self, model: str, texts: list[str], task_type: str, dims: int) -> EmbedResult:
        with self._lock:
            self.embed_calls.append((model, list(texts), task_type, dims))
        vectors = []
        for t in texts:
            seed = int.from_bytes(hashlib.sha256(t.encode("utf-8")).digest()[:8], "big")
            v = np.random.default_rng(seed).standard_normal(dims)
            vectors.append((v / np.linalg.norm(v)).tolist())
        return EmbedResult(vectors, model, sum(len(t) for t in texts) // 4, 1)

    # ------------------------------------------------------------------ default prompt behaviour
    @staticmethod
    def default_P_00(call: FakeCall) -> dict[str, Any]:
        duration = float(call.line("CLIP_DURATION_SECONDS") or 20)
        return {"language": "en", "utterances": [
            {"start": 0.5, "end": min(duration, 6.0), "speaker": "S1", "text": "Welcome to this short evening reflection."},
            {"start": min(duration, 6.5), "end": min(duration, 12.0), "speaker": "S1", "text": "Tonight we read John 3:16 together."},
        ]}

    @staticmethod
    def default_P_01(call: FakeCall) -> dict[str, Any]:
        """Group units into ~45 s contiguous segments (every unit exactly once, in order)."""
        units = []
        for row in call.section("UNITS").splitlines():
            parts = [p.strip() for p in row.split("|")]
            if len(parts) >= 6:
                units.append((parts[0], float(parts[1]), float(parts[2]), parts[5]))
        segments: list[dict[str, Any]] = []
        current: list[tuple[str, float, float, str]] = []
        for unit in units:
            if current and unit[2] - current[0][1] > 45.0:
                segments.append(current)
                current = []
            current.append(unit)
        if current:
            segments.append(current)
        return {"segments": [
            {"start": seg[0][1], "end": seg[-1][2], "unit_ids": [u[0] for u in seg], "topic_hint": " ".join(seg[0][3].split()[:4]), "boundary_reason": "fake_semantic_shift"}
            for seg in segments
        ]}

    @staticmethod
    def default_P_02(call: FakeCall) -> dict[str, Any]:
        """Confirm every parser candidate exactly as proposed."""
        refs = []
        for cand in call.json_line("PARSER_CANDIDATES") or []:
            start, _, end = cand["canonical"].partition("-")
            refs.append({"raw_text": cand["raw_text"], "canonical_start": start, "canonical_end": end or start,
                         "evidence_quote": cand["raw_text"], "confidence": 0.96})
        return {"references": refs}

    @staticmethod
    def default_P_03(call: FakeCall) -> dict[str, Any]:
        segment = call.section("SEGMENT")
        matches = []
        for cand in call.json_line("CANDIDATES") or []:
            overlap = float(cand.get("lexical_overlap") or 0)
            if overlap >= 0.6:
                cls = "exact_quote"
            elif overlap >= 0.35:
                cls = "close_quote"
            elif overlap >= 0.2:
                cls = "theme_only"
            else:
                cls = "unrelated"
            evidence = best_sentence(segment, cand.get("text", "")) if cls in ("exact_quote", "close_quote") else ""
            matches.append({"verse": cand["verse"], "classification": cls, "evidence": evidence, "confidence": 0.9 if cls != "unrelated" else 0.2})
        return {"matches": matches}

    @staticmethod
    def default_P_04(call: FakeCall) -> dict[str, Any]:
        """Conservative default: reject every semantic candidate."""
        return {"accepted": [], "rejected": [{"verse": c["verse"], "reason": "only shares a keyword"} for c in call.json_line("CANDIDATES") or []]}

    @staticmethod
    def default_P_05(call: FakeCall) -> dict[str, Any]:
        """Echo detector results unchanged (never upgrades); primary = first direct ref, else first quote."""
        relationships: list[dict[str, Any]] = []
        for label, rtype in (("DIRECT_REFERENCES", "direct_reference"), ("QUOTE_MATCHES", "scripture_quote"),
                             ("CONTEXTUAL_REFERENCES", "contextual_reference"), ("SEMANTIC_MATCHES", "ai_related")):
            for row in call.json_line(label) or []:
                relationships.append({"verse": row["verse"], "type": rtype, "confidence": row["confidence"], "evidence": row.get("evidence") or "", "primary": False})
        primary = next((r["verse"] for r in relationships if r["type"] == "direct_reference"), None) or \
            next((r["verse"] for r in relationships if r["type"] == "scripture_quote"), None)
        for r in relationships:
            r["primary"] = r["verse"] == primary
        return {"primary_verse": primary, "relationships": relationships}

    @staticmethod
    def default_P_06(call: FakeCall) -> dict[str, Any]:
        segment = call.section("SEGMENT").lower()
        topics = [name for name in (call.json_line("TOPIC_VOCAB") or []) if name.lower() in segment][:3]
        entity_vocab = call.json_line("ENTITY_VOCAB") or {}
        events = [name for name in entity_vocab.get("event", []) if name.lower() in segment][:2]
        return {"topics": [{"name": t, "confidence": 0.8} for t in topics], "people": [], "places": [],
                "events": [{"name": e, "confidence": 0.75} for e in events], "life_situations": [], "questions": []}

    @staticmethod
    def default_P_07(call: FakeCall) -> dict[str, Any]:
        first = " ".join(call.section("SEGMENT").split()[:12])
        return {"summary": f"The speaker says: {first}"}

    @staticmethod
    def default_P_08(call: FakeCall) -> dict[str, Any]:
        units = []
        for row in call.section("TIMESTAMPED_UNITS").splitlines():
            parts = [p.strip() for p in row.split("|", 3)]
            if len(parts) == 4:
                units.append((parts[0], int(parts[1]), int(parts[2]), parts[3]))
        evidence = words(call.section("CORE_EVIDENCE"))
        core = max(range(len(units)), key=lambda i: len(words(units[i][3]) & evidence))
        lo = hi = core
        while units[hi][2] - units[lo][1] < 30_000 and (lo > 0 or hi < len(units) - 1):
            if hi < len(units) - 1:
                hi += 1
            if units[hi][2] - units[lo][1] < 30_000 and lo > 0:
                lo -= 1
        return {"start_ms": units[lo][1], "end_ms": units[hi][2], "core_start_ms": units[core][1], "core_end_ms": units[core][2],
                "reason": "Complete thought around the verse discussion", "confidence": 0.86}

    @staticmethod
    def default_P_09(call: FakeCall) -> dict[str, Any]:
        return {"why_related": "Both passages speak about God's faithful care for his people.", "confidence": 0.82}

    @staticmethod
    def default_P_10(call: FakeCall) -> dict[str, Any]:
        from interactive_bible.bible.refparser import find_query_references

        query = call.section("QUERY")
        low = query.lower()
        topics = [name for name in (call.json_line("TOPIC_VOCAB") or []) if name.lower() in low]
        types = [t for t in ("video", "audio", "sermon", "podcast", "study", "devotional", "article", "pdf", "document") if re.search(rf"\b{t}s?\b", low)]
        return {"explicit_refs": [r.canonical for r in find_query_references(query)], "topics": topics[:3], "entities": [],
                "resource_types": types, "semantic_query": query, "search_scope": "both"}

    @staticmethod
    def default_P_11(call: FakeCall) -> dict[str, Any]:
        try:
            candidates = json.loads(call.section("CANDIDATES") or "[]")
        except json.JSONDecodeError:
            candidates = []
        n = max(1, len(candidates))
        return {"ranked": [{"id": c["id"], "score": round(1.0 - i / (n + 1), 3), "reason": "Directly addresses the query"} for i, c in enumerate(candidates)]}

    @staticmethod
    def default_P_12(call: FakeCall) -> dict[str, Any]:
        return {"approved": [m["verse"] for m in call.json_line("PROPOSED_MAPPINGS") or []], "needs_review": [], "rejected": []}

    @staticmethod
    def default_P_13(call: FakeCall) -> dict[str, Any]:
        verse = call.line("VERSE")
        return {"hook": "Hope in hard seasons", "verse_label": verse, "caption_lines": ["God works in every season."], "description": f"A short reflection on {verse}."}

    @staticmethod
    def default_P_14(call: FakeCall) -> dict[str, Any]:
        verse = call.line("SELECTED_VERSE").split(" ")[0]
        return {"answer": "The verse promises that God is at work for those who love him.", "citations": [{"kind": "verse", "id": verse}],
                "interpretive_note": None, "confidence": 0.7}

    @staticmethod
    def default_P_15(call: FakeCall) -> dict[str, Any]:
        return {"topics": [{"name": "Hope", "confidence": 0.8}], "people": [], "places": [], "events": [], "life_situations": [], "questions": []}

    @staticmethod
    def default_P_16(call: FakeCall) -> dict[str, Any]:
        """Message locator: sections marked [music] are worship, everything else is the message."""
        rows = [row for row in call.section("SECTIONS").splitlines() if row.strip().startswith("#")]
        parts = []
        for row in rows:
            ordinal = int(row.split("|", 1)[0].strip().lstrip("#"))
            parts.append({"ordinal": ordinal, "part": "worship" if "[music]" in row else "message"})
        spoken = [p["ordinal"] for p in parts if p["part"] == "message"]
        return {"parts": parts, "message_start_ordinal": min(spoken, default=-1), "message_end_ordinal": max(spoken, default=-1),
                "confidence": 0.9, "reason": "The teaching runs between the songs."}

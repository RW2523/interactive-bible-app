"""AI teaching content for an atlas event (E-01): generated once from the authoritative event data, then served from
the LLM cache to every user at no cost."""
from __future__ import annotations

import json
from typing import Any

from ...ai.llm import AIUnavailable, LLMResult, get_llm
from ...ai.schemas_explore import EventContentOut
from ..bible import NotFound
from . import data
from .common import run_shared

PROMPT_ID = "E-01"
PROMPT_FIELDS = ("id", "title", "era", "timelineDate", "mapLocation", "references", "summary", "details", "mainPeople",
                 "lineageConnection", "lesson", "route", "placeContext", "journey", "eventTags", "roleTags")


def prompt_variables(event: dict[str, Any]) -> dict[str, Any]:
    payload = {k: event[k] for k in PROMPT_FIELDS if event.get(k) not in (None, "", [], {})}
    return {"event": json.dumps(payload, ensure_ascii=False, indent=2)}


def _response(result: LLMResult[EventContentOut]) -> dict[str, Any]:
    return {"mode": "gemini", "cached": result.cached, **result.output.model_dump()}


def generate_content(event_id: str) -> dict[str, Any]:
    """Cached content, or generate it now (raises AIUnavailable -> 503 when AI is not available)."""
    event = data.get_event(event_id)
    return _response(run_shared(PROMPT_ID, prompt_variables(event), EventContentOut))


def cached_content(event_id: str) -> dict[str, Any]:
    """Previously generated content only; never calls the model."""
    event = data.get_event(event_id)
    try:
        result = get_llm().run(PROMPT_ID, prompt_variables(event), EventContentOut, cache_only=True)
    except AIUnavailable:
        raise NotFound("not generated yet") from None
    return _response(result)

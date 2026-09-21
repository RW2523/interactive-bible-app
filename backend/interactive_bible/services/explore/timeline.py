"""Timeline AI: explain one timeline event (E-03) and build a guided story-mode walk through several (E-04).

Prompts are always built from the authoritative timeline data loaded server-side by event id, never from titles or
references sent by the client. Results are cached and shared by every user.
"""
from __future__ import annotations

import json
from typing import Any

from pydantic import model_validator

from ...ai.schemas_explore import TimelineExplainOut, TimelineStoryOut
from . import data
from .common import run_shared

EXPLAIN_MODES = {
    "simple": "Write for a general audience: clear and reverent.",
    "kids": "Write for children (ages 8-12): simple words, short sentences.",
    "pastor": "Write for pastors: concise exegesis-aware notes, still accessible.",
    "study": "Write for adult Bible study: clear and structured.",
}
STORY_AUDIENCES = {
    "general": "A general audience: clear and reverent.",
    "kids": "Children (ages 8-12): simple words, short sentences.",
    "youth": "Teenagers and young adults: engaging and direct, still reverent.",
    "pastor": "Pastors and teachers: concise, exegesis-aware and accessible.",
}
STORY_LENGTHS = {  # duration -> (max scenes, instruction)
    "short": (6, "short: at most 6 scenes; voiceText of 1-2 sentences."),
    "medium": (12, "medium: at most 12 scenes; voiceText of 2-3 sentences."),
}
MAX_STORY_EVENTS = 24
EVENT_FIELDS = ("id", "title", "dateLabel", "eraGroup", "section", "scriptureTestament", "referenceText", "references")
STORY_EVENT_FIELDS = ("id", "title", "dateLabel", "eraGroup", "referenceText", "references")


def _prompt_event(event: dict[str, Any], fields: tuple[str, ...]) -> dict[str, Any]:
    return {k: event[k] for k in fields if event.get(k) not in (None, "", [])}


def explain(event_id: str, mode: str = "simple") -> dict[str, Any]:
    if mode not in EXPLAIN_MODES:
        raise ValueError(f"mode must be one of {', '.join(EXPLAIN_MODES)}")
    event = data.get_timeline_event(event_id)
    result = run_shared("E-03", {
        "audience_instruction": EXPLAIN_MODES[mode],
        "event": json.dumps(_prompt_event(event, EVENT_FIELDS), ensure_ascii=False, indent=2),
    }, TimelineExplainOut)
    return {"mode": "gemini", "cached": result.cached, "eventId": event["id"], **result.output.model_dump()}


def _story_schema(event_ids: frozenset[str]) -> type[TimelineStoryOut]:
    class TimelineStoryForEvents(TimelineStoryOut):
        @model_validator(mode="after")
        def _only_supplied_events(self):
            # never surface (or cache) an event id the model made up
            self.scenes = [scene for scene in self.scenes if scene.eventId in event_ids]
            if not self.scenes:
                raise ValueError("every scene must use the exact id of one of the supplied timeline events")
            return self

    return TimelineStoryForEvents


def story_mode(event_ids: list[str], audience: str = "general", duration: str = "short") -> dict[str, Any]:
    if audience not in STORY_AUDIENCES:
        raise ValueError(f"audience must be one of {', '.join(STORY_AUDIENCES)}")
    if duration not in STORY_LENGTHS:
        raise ValueError(f"duration must be one of {', '.join(STORY_LENGTHS)}")
    dataset = data.timeline()
    events: list[dict[str, Any]] = []
    for event_id in dict.fromkeys(event_ids[:MAX_STORY_EVENTS]):  # unknown ids are ignored, duplicates collapse
        event = dataset.by_id.get(event_id) if isinstance(event_id, str) else None
        if event is not None:
            events.append(event)
    if not events:
        raise ValueError("none of the requested timeline events exist")
    max_scenes, length_instruction = STORY_LENGTHS[duration]
    result = run_shared("E-04", {
        "audience_instruction": STORY_AUDIENCES[audience],
        "length_instruction": length_instruction,
        "max_scenes": max_scenes,
        "events": json.dumps([_prompt_event(e, STORY_EVENT_FIELDS) for e in events], ensure_ascii=False, indent=2),
    }, _story_schema(frozenset(e["id"] for e in events)))
    by_id = {e["id"]: e for e in events}
    scenes = [{
        "eventId": scene.eventId,
        "title": scene.title or by_id[scene.eventId].get("title") or "",
        "imagePrompt": scene.imagePrompt,
        "voiceText": scene.voiceText,
        "scriptureReference": scene.scriptureReference or by_id[scene.eventId].get("referenceText") or "",
    } for scene in result.output.scenes[:max_scenes]]
    return {"mode": "gemini", "cached": result.cached, "title": result.output.title or "Timeline story",
            "narration": result.output.narration, "scenes": scenes}

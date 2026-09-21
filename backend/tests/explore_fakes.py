"""Default offline responses for the Explore prompts (E-01..E-04) plus failure helpers for images and narration.

Responses are built from the event data in the rendered prompt, so they stay plausible for any event. Install them in
a fixture with ``install(fake_llm)`` (it uses ``fake_llm.on``); tests can still override single prompts afterwards.
"""
from __future__ import annotations

import json
from typing import Any

from interactive_bible.ai.gemini import GeminiError

from .fakes import FakeCall, FakeGeminiClient


def _json_section(call: FakeCall, label: str, default: Any) -> Any:
    raw = call.section(label)
    return json.loads(raw) if raw else default


def event_content(call: FakeCall) -> dict[str, Any]:
    event = _json_section(call, "EVENT", {})
    title = event.get("title", "this event")
    people = event.get("mainPeople") or ["God's people"]
    return {
        "teachingSummary": f"{title} is recorded in {', '.join(event.get('references') or ['Scripture'])}. {event.get('summary', '')}".strip(),
        "mapExplanation": f"{title} is shown near {event.get('mapLocation') or 'the lands of the Bible'}.",
        "lineageExplanation": f"{title} continues the family story through {', '.join(event.get('lineageConnection') or people)}.",
        "applicationLesson": event.get("lesson") or "Trust God's faithfulness.",
        "discussionQuestions": [f"What happens in {title}?", f"Who is involved in {title}?", "What does this event teach about God?"],
        "quiz": [{"question": f"Who is a main person in {title}?", "options": [people[0], "Nebuchadnezzar", "Herod", "Pontius Pilate"], "answer": people[0]}],
    }


def story_script(call: FakeCall) -> dict[str, Any]:
    event = _json_section(call, "EVENT", {})
    count = int(call.line("SCENE_COUNT") or 4)
    image_format = call.line("IMAGE_FORMAT") or "landscape"
    title = event.get("title", "Bible event")
    scenes = [{"title": f"{title}, part {i}", "durationSec": 4 + i % 3, "narration": f"Scene {i} of {title}.",
               "imagePrompt": f"{image_format} illustration {i} of {title}"} for i in range(1, count + 1)]
    return {
        "title": f"The story of {title}",
        "reference": ", ".join(event.get("references") or []),
        "narration": f"This is the story of {title}. " + " ".join(s["narration"] for s in scenes),
        "scenes": scenes,
        "quiz": [{"question": f"Where did {title} happen?", "answer": event.get("mapLocation") or "In the lands of the Bible"}],
    }


def timeline_explain(call: FakeCall) -> dict[str, Any]:
    event = _json_section(call, "TIMELINE_EVENT", {})
    title = event.get("title", "This event")
    return {
        "summary": f"{title} (about {event.get('dateLabel', 'an unknown date')}, approximate) is recorded in {event.get('referenceText', 'Scripture')}.",
        "whyItMatters": f"{title} moves the Bible story forward.",
        "historicalContext": f"It belongs to the era of {event.get('eraGroup', 'the Bible')}.",
        "spiritualLesson": "God keeps his promises.",
        "keyPeople": [],
        "keyPlaces": [],
        "crossReferences": list(event.get("references") or []),
        "discussionQuestions": [f"What does {title} teach about God?"],
    }


def timeline_story_mode(call: FakeCall) -> dict[str, Any]:
    events = _json_section(call, "TIMELINE_EVENTS", [])
    max_scenes = int(call.line("MAX_SCENES") or 6)
    scenes = [{"eventId": e["id"], "title": e.get("title", ""), "imagePrompt": f"Illustrated scene: {e.get('title', '')}",
               "voiceText": f"{e.get('title', '')} happened around {e.get('dateLabel', 'an unknown date')}.",
               "scriptureReference": e.get("referenceText", "")} for e in events[:max_scenes]]
    return {"title": "A walk through the Bible timeline", "narration": " ".join(s["voiceText"] for s in scenes), "scenes": scenes}


DEFAULTS = {"E-01": event_content, "E-02": story_script, "E-03": timeline_explain, "E-04": timeline_story_mode}


def install(fake: FakeGeminiClient) -> FakeGeminiClient:
    for prompt_id, handler in DEFAULTS.items():
        fake.on(prompt_id, handler)
    return fake


def fail_images_matching(fake: FakeGeminiClient, needle: str) -> None:
    """Every image request whose prompt contains ``needle`` fails like an overloaded model (recorded in image_calls)."""
    generate_image = fake.generate_image

    def failing(prompt: str, models: list[str], *, aspect_ratio: str | None = "16:9", image_size: str | None = "1K"):
        if needle in prompt:
            fake.image_calls.append((prompt, list(models), aspect_ratio, image_size))
            raise GeminiError("the image model is overloaded", status=503, kind="error")
        return generate_image(prompt, models, aspect_ratio=aspect_ratio, image_size=image_size)

    fake.generate_image = failing  # type: ignore[method-assign]


def fail_speech(fake: FakeGeminiClient) -> None:
    def failing(text: str, models: list[str], *, voice: str = "Kore", style: str = ""):
        fake.speech_calls.append((text, list(models), voice, style))
        raise GeminiError("the speech model is unavailable", status=503, kind="error")

    fake.synthesize_speech = failing  # type: ignore[method-assign]

"""Machine-validated output schemas for the Sermon Studio prompts (S-01..S-07).

Validation is lenient in the way sermon-builder's ``normalizeStructured`` was (aliases, strings for lists, nulls), while the JSON
schema sent to Gemini marks the fields as required so structured output stays complete.

No property is literally named ``title``: ``ai.gemini.to_json_schema`` strips every ``title`` key while inlining refs, which would
drop such a property from the response schema. The sermon title therefore travels as ``sermon_title`` and illustration ideas
use ``name`` (the service maps both back to ``title``).
"""
from __future__ import annotations

import re
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, field_validator, model_validator


def _config(*required: str) -> ConfigDict:
    return ConfigDict(extra="ignore", json_schema_extra={"required": list(required)})


def _first(obj: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        if obj.get(key) is not None:
            return obj[key]
    return None


def _text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, (int, float, bool)):
        return str(value)
    if isinstance(value, list):
        return " ".join(t for t in (_text(v) for v in value) if t)
    if isinstance(value, dict):
        return " ".join(t for t in (_text(v) for v in value.values() if isinstance(v, (str, int, float))) if t)
    return str(value)


def _text_list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [t for t in (_text(v) for v in value) if t]
    text = _text(value)
    if not text:
        return []
    return [p.strip() for p in re.split(r"\n+|(?:^|\s)\d+[.)]\s+", text) if p and p.strip()]


def _object_list(value: Any) -> list[Any]:
    if value is None:
        return []
    return value if isinstance(value, list) else [value]


# ---------------------------------------------------------------------------------------------- S-01 polish / S-02 format
class SermonPointOut(BaseModel):
    model_config = _config("heading", "body", "scripture")

    heading: str = ""
    body: str = ""
    scripture: str | None = None

    @model_validator(mode="before")
    @classmethod
    def _aliases(cls, value: Any) -> Any:
        if isinstance(value, str):
            return {"heading": "", "body": value}
        if isinstance(value, dict):
            return {"heading": _first(value, "heading", "title", "point"), "body": _first(value, "body", "content", "text"),
                    "scripture": _first(value, "scripture", "verse")}
        return value

    @field_validator("heading", "body", mode="before")
    @classmethod
    def _strings(cls, value: Any) -> str:
        return _text(value)

    @field_validator("scripture", mode="before")
    @classmethod
    def _reference(cls, value: Any) -> str | None:
        text = _text(value)
        return None if text.lower() in ("", "null", "none", "n/a") else text


class StructuredSermonOut(BaseModel):
    model_config = _config("sermon_title", "theme", "scripture", "introduction", "main_points", "applications", "conclusion", "prayer")

    sermon_title: str = ""
    theme: str = ""
    scripture: str = ""
    introduction: str = ""
    main_points: list[SermonPointOut] = []
    applications: list[str] = []
    conclusion: str = ""
    prayer: str = ""

    @model_validator(mode="before")
    @classmethod
    def _aliases(cls, value: Any) -> Any:
        if not isinstance(value, dict):
            return value
        return {
            "sermon_title": _first(value, "sermon_title", "title"), "theme": value.get("theme"),
            "scripture": _first(value, "scripture", "verse", "scripture_ref"), "introduction": _first(value, "introduction", "intro"),
            "main_points": _first(value, "main_points", "points", "mainPoints"), "applications": _first(value, "applications", "application"),
            "conclusion": value.get("conclusion"), "prayer": value.get("prayer"),
        }

    @field_validator("sermon_title", "theme", "scripture", "introduction", "conclusion", "prayer", mode="before")
    @classmethod
    def _strings(cls, value: Any) -> str:
        return _text(value)

    @field_validator("main_points", mode="before")
    @classmethod
    def _points(cls, value: Any) -> list[Any]:
        return [p for p in _object_list(value) if isinstance(p, (str, dict))]

    @field_validator("applications", mode="before")
    @classmethod
    def _applications(cls, value: Any) -> list[str]:
        return _text_list(value)

    def structured(self) -> dict[str, Any]:
        """The canonical structured-sermon shape (``title`` instead of ``sermon_title``)."""
        data = self.model_dump()
        data["title"] = data.pop("sermon_title")
        return data


# ---------------------------------------------------------------------------------------------- S-03 coaching suggestions
class IllustrationIdea(BaseModel):
    model_config = _config("name", "description")

    name: str = ""
    description: str = ""

    @model_validator(mode="before")
    @classmethod
    def _aliases(cls, value: Any) -> Any:
        if isinstance(value, str):
            return {"name": "", "description": value}
        if isinstance(value, dict):
            return {"name": _first(value, "name", "title", "heading"), "description": _first(value, "description", "details", "text")}
        return value

    @field_validator("name", "description", mode="before")
    @classmethod
    def _strings(cls, value: Any) -> str:
        return _text(value)


class ApplicationIdea(BaseModel):
    model_config = _config("point", "suggestion")

    point: str = ""
    suggestion: str = ""

    @model_validator(mode="before")
    @classmethod
    def _aliases(cls, value: Any) -> Any:
        return {"point": "", "suggestion": value} if isinstance(value, str) else value

    @field_validator("point", "suggestion", mode="before")
    @classmethod
    def _strings(cls, value: Any) -> str:
        return _text(value)


class ScriptureConnection(BaseModel):
    model_config = _config("reference", "connection")

    reference: str = ""
    connection: str = ""

    @field_validator("reference", "connection", mode="before")
    @classmethod
    def _strings(cls, value: Any) -> str:
        return _text(value)


class SuggestionsOut(BaseModel):
    model_config = _config("illustrations", "applications", "scripture_connections", "opening_hooks", "closing_calls", "strengthening_tips")

    illustrations: list[IllustrationIdea] = []
    applications: list[ApplicationIdea] = []
    scripture_connections: list[ScriptureConnection] = []
    opening_hooks: list[str] = []
    closing_calls: list[str] = []
    strengthening_tips: list[str] = []

    @field_validator("illustrations", "applications", "scripture_connections", mode="before")
    @classmethod
    def _objects(cls, value: Any) -> list[Any]:
        return _object_list(value)

    @field_validator("opening_hooks", "closing_calls", "strengthening_tips", mode="before")
    @classmethod
    def _strings(cls, value: Any) -> list[str]:
        return _text_list(value)


# ---------------------------------------------------------------------------------------------- S-04 speaker notes
class SpeakerNotesOut(BaseModel):
    model_config = _config("notes")

    notes: str

    @field_validator("notes", mode="before")
    @classmethod
    def _notes(cls, value: Any) -> str:
        if isinstance(value, list):  # sections returned as a list
            return "\n\n".join(t for t in (_text(v) for v in value) if t)
        return value.strip() if isinstance(value, str) else _text(value)


# ---------------------------------------------------------------------------------------------- S-05 slide diagram enrichment
DiagramShape = Literal["hubSpoke", "flow", "compare", "pyramid", "list"]
DIAGRAM_SHAPES = ("hubSpoke", "flow", "compare", "pyramid", "list")


class EnrichmentPlace(BaseModel):
    model_config = _config("name")

    name: str = ""
    note: str | None = None


class EnrichmentStop(BaseModel):
    model_config = _config("name", "order")

    name: str = ""
    order: int = 0
    note: str | None = None


class EnrichmentEvent(BaseModel):
    model_config = _config("label")

    label: str = ""
    date: str | None = None
    note: str | None = None


class DiagramNode(BaseModel):
    model_config = _config("label")

    label: str = ""
    detail: str | None = None


class EnrichmentDiagram(BaseModel):
    model_config = _config("shape", "nodes")

    shape: DiagramShape = "list"
    center: str | None = None
    nodes: list[DiagramNode] = []
    left_header: str | None = None
    right_header: str | None = None
    left_items: list[str] = []
    right_items: list[str] = []

    @field_validator("shape", mode="before")
    @classmethod
    def _shape(cls, value: Any) -> str:
        if isinstance(value, str):
            match = next((s for s in DIAGRAM_SHAPES if s.lower() == value.replace("_", "").replace("-", "").lower()), None)
            if match:
                return match
        return "list"

    @field_validator("nodes", mode="before")
    @classmethod
    def _nodes(cls, value: Any) -> list[Any]:
        return [{"label": v} if isinstance(v, str) else v for v in _object_list(value)]

    @field_validator("left_items", "right_items", mode="before")
    @classmethod
    def _items(cls, value: Any) -> list[str]:
        return _text_list(value)


class SlideEnrichment(BaseModel):
    model_config = _config("point", "kind", "heading", "caption")

    point: int = 0
    kind: Literal["map", "route", "timeline", "diagram"]
    heading: str = ""
    caption: str | None = None
    places: list[EnrichmentPlace] = []
    route_stops: list[EnrichmentStop] = []
    events: list[EnrichmentEvent] = []
    diagram: EnrichmentDiagram | None = None

    @model_validator(mode="before")
    @classmethod
    def _aliases(cls, value: Any) -> Any:
        if isinstance(value, dict) and value.get("route_stops") is None and value.get("routeStops") is not None:
            value = {**value, "route_stops": value["routeStops"]}
        return value

    @field_validator("point", mode="before")
    @classmethod
    def _point(cls, value: Any) -> int:
        try:
            return max(0, int(value))
        except (TypeError, ValueError):
            return 0

    @field_validator("places", "route_stops", "events", mode="before")
    @classmethod
    def _lists(cls, value: Any) -> list[Any]:
        return _object_list(value)


class SlideEnrichmentOut(BaseModel):
    model_config = _config("visuals")

    visuals: list[SlideEnrichment] = []

    @field_validator("visuals", mode="before")
    @classmethod
    def _visuals(cls, value: Any) -> list[Any]:
        # drop kinds the deck cannot draw instead of failing the whole enrichment
        return [v for v in _object_list(value) if isinstance(v, dict) and v.get("kind") in ("map", "route", "timeline", "diagram")]


# ---------------------------------------------------------------------------------------------- S-06 image prompt
class ImagePromptOut(BaseModel):
    model_config = _config("prompt")

    prompt: str

    @field_validator("prompt", mode="before")
    @classmethod
    def _prompt(cls, value: Any) -> str:
        return _text(value).strip().strip('"“”').strip()


# ---------------------------------------------------------------------------------------------- S-07 outreach
class OutreachOut(BaseModel):
    model_config = _config("summary", "social_caption", "hashtags", "instagram_caption", "facebook_post", "twitter_thread")

    summary: str
    social_caption: str
    hashtags: list[str] = []
    instagram_caption: str = ""
    facebook_post: str = ""
    twitter_thread: list[str] = []

    @field_validator("summary", "social_caption", mode="before")
    @classmethod
    def _required_text(cls, value: Any) -> Any:
        return value.strip() if isinstance(value, str) else value  # non-strings fail validation (the model is asked again)

    @field_validator("instagram_caption", "facebook_post", mode="before")
    @classmethod
    def _strings(cls, value: Any) -> str:
        return _text(value)

    @field_validator("hashtags", mode="before")
    @classmethod
    def _hashtags(cls, value: Any) -> list[str]:
        if isinstance(value, str):
            return [t for t in re.split(r"[\s,]+", value) if t.strip("#")]
        return _text_list(value)

    @field_validator("twitter_thread", mode="before")
    @classmethod
    def _thread(cls, value: Any) -> list[str]:
        if isinstance(value, str):
            return [value.strip()] if value.strip() else []
        return _text_list(value)

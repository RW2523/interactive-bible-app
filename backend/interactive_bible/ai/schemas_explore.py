"""Machine-validated output schemas for the Explore prompts (E-01..E-04).

Field names are camelCase on purpose: the Explore API returns these objects as-is, with the keys the atlas and
timeline UI have always used (teachingSummary, imagePrompt, voiceText, ...).
"""
from __future__ import annotations

import re

from pydantic import BaseModel, Field, ValidationError, field_validator, model_validator


class _Base(BaseModel):
    model_config = {"extra": "ignore"}


def _clean(value: object) -> object:
    return value.strip() if isinstance(value, str) else value


def _string_list(value: object) -> object:
    """Accept a single string as a one-item list, and drop blank entries."""
    if isinstance(value, str):
        value = [value]
    if isinstance(value, list):
        return [v.strip() for v in value if isinstance(v, str) and v.strip()]
    return value


# E-01 atlas event teaching content
class QuizQuestion(_Base):
    question: str = Field(min_length=1)
    options: list[str] = Field(min_length=4, max_length=4)
    answer: str = Field(min_length=1)

    @field_validator("question", "answer", mode="before")
    @classmethod
    def _strip(cls, v):
        return _clean(v)

    @field_validator("options", mode="before")
    @classmethod
    def _options(cls, v):
        v = _string_list(v)
        return v[:4] if isinstance(v, list) and len(v) > 4 else v

    @model_validator(mode="after")
    def _answer_is_an_option(self):
        # models sometimes answer with the option letter ("B") or different casing: normalise to the option text
        letter = re.fullmatch(r"\(?([A-Da-d])[).:]?", self.answer)
        if letter:
            self.answer = self.options["abcd".index(letter.group(1).lower())]
        else:
            match = next((o for o in self.options if o.casefold() == self.answer.casefold()), None)
            if match is None:
                raise ValueError("quiz answer must repeat one of the four options exactly")
            self.answer = match
        return self


class EventContentOut(_Base):
    teachingSummary: str = Field(min_length=1)
    mapExplanation: str = Field(min_length=1)
    lineageExplanation: str = Field(min_length=1)
    applicationLesson: str = Field(min_length=1)
    discussionQuestions: list[str] = []
    quiz: list[QuizQuestion] = []

    @field_validator("teachingSummary", "mapExplanation", "lineageExplanation", "applicationLesson", mode="before")
    @classmethod
    def _strip(cls, v):
        return _clean(v)

    @field_validator("discussionQuestions", mode="before")
    @classmethod
    def _questions(cls, v):
        return _string_list(v)

    @field_validator("quiz", mode="before")
    @classmethod
    def _valid_quiz_items_only(cls, v):
        # one malformed quiz question should not throw away (and re-bill) the whole teaching content
        if not isinstance(v, list):
            return v
        kept = []
        for item in v:
            try:
                kept.append(QuizQuestion.model_validate(item))
            except ValidationError:
                continue
        return kept


# E-02 story video script
def _seconds(value: object) -> object:
    """6, 6.5, "6", "6s", "6 seconds" -> float seconds."""
    if isinstance(value, str):
        m = re.search(r"\d+(?:\.\d+)?", value)
        return float(m.group(0)) if m else value
    return value


class StoryScene(_Base):
    title: str = Field(min_length=1)
    durationSec: float = Field(default=6.0, ge=2.0, le=30.0)
    narration: str = Field(min_length=1)
    imagePrompt: str = Field(min_length=1)

    @field_validator("title", "narration", "imagePrompt", mode="before")
    @classmethod
    def _strip(cls, v):
        return _clean(v)

    @field_validator("durationSec", mode="before")
    @classmethod
    def _duration(cls, v):
        v = _seconds(v)
        if v is None:
            return 6.0
        if isinstance(v, (int, float)):
            return min(30.0, max(2.0, float(v)))  # a slightly long or short scene is not worth a retry
        return v


class StoryQuizItem(_Base):
    question: str = Field(min_length=1)
    answer: str = Field(min_length=1)


class StoryScriptOut(_Base):
    title: str = ""
    reference: str = ""
    narration: str = Field(min_length=1)
    scenes: list[StoryScene] = Field(min_length=3)
    quiz: list[StoryQuizItem] = []

    @field_validator("title", "reference", "narration", mode="before")
    @classmethod
    def _strip(cls, v):
        return "" if v is None else _clean(v)


# E-03 timeline event explanation
class TimelineExplainOut(_Base):
    summary: str = Field(min_length=1)
    whyItMatters: str = ""
    historicalContext: str = ""
    spiritualLesson: str = ""
    keyPeople: list[str] = []
    keyPlaces: list[str] = []
    crossReferences: list[str] = []
    discussionQuestions: list[str] = []

    @field_validator("summary", "whyItMatters", "historicalContext", "spiritualLesson", mode="before")
    @classmethod
    def _strip(cls, v):
        return "" if v is None else _clean(v)

    @field_validator("keyPeople", "keyPlaces", "crossReferences", "discussionQuestions", mode="before")
    @classmethod
    def _lists(cls, v):
        return [] if v is None else _string_list(v)


# E-04 timeline story mode
class TimelineStoryScene(_Base):
    eventId: str = Field(min_length=1)
    title: str = ""
    imagePrompt: str = ""
    voiceText: str = Field(min_length=1)
    scriptureReference: str = ""

    @field_validator("eventId", "title", "imagePrompt", "voiceText", "scriptureReference", mode="before")
    @classmethod
    def _strip(cls, v):
        return "" if v is None else _clean(v)


class TimelineStoryOut(_Base):
    title: str = ""
    narration: str = ""
    scenes: list[TimelineStoryScene] = Field(min_length=1)

    @field_validator("title", "narration", mode="before")
    @classmethod
    def _strip(cls, v):
        return "" if v is None else _clean(v)

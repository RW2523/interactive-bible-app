"""Vocabulary seeding, lookup and deterministic tagging helpers."""
from __future__ import annotations

import re
from dataclasses import dataclass
from functools import lru_cache

from sqlalchemy.orm import Session

from ..bible import books as B
from ..db import execute, fetch_all
from .data import ENTITIES, TOPICS

# names that appear in a single biblical narrative, so a mention implies that passage
UNIQUE_STORY_NAMES = {"zacchaeus", "zaccheus"}

# personal names that are too common to tag without scripture corroboration
COMMON_NAMES = {
    "john", "james", "mary", "joseph", "david", "daniel", "paul", "peter", "thomas", "stephen", "timothy", "mark",
    "luke", "matthew", "sarah", "ruth", "samuel", "aaron", "adam", "eve", "martha", "joshua", "esther", "jacob",
    "isaac", "noah", "solomon", "naomi", "christ", "jesus",
}


@dataclass(frozen=True)
class EntityDef:
    id: str
    type: str
    name: str
    aliases: tuple[str, ...]
    passages: tuple[tuple[int, int], ...]
    link_passages: bool
    description: str


def seed_vocabulary(session: Session) -> dict[str, int]:
    for slug, name, category, aliases in TOPICS:
        execute(
            session,
            """INSERT INTO topics (id, name, category, canonical_slug, aliases, is_controlled)
               VALUES (:id, :name, :category, :slug, :aliases, true)
               ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category, aliases = EXCLUDED.aliases""",
            id=f"topic_{slug}", name=name, category=category, slug=slug, aliases=aliases,
        )
    for key, etype, name, aliases, passages, link, desc in ENTITIES:
        for p in passages:
            if B.parse_canonical_range(p) is None:
                raise ValueError(f"invalid passage {p} for {key}")
        execute(
            session,
            """INSERT INTO entities (id, type, name, canonical_key, description, aliases, passages, link_passages, is_controlled)
               VALUES (:id, :type, :name, :key, :desc, :aliases, :passages, :link, true)
               ON CONFLICT (id) DO UPDATE SET type = EXCLUDED.type, name = EXCLUDED.name, description = EXCLUDED.description,
                 aliases = EXCLUDED.aliases, passages = EXCLUDED.passages, link_passages = EXCLUDED.link_passages""",
            id=f"ent_{key}", type=etype, name=name, key=key, desc=desc, aliases=aliases, passages=passages, link=link,
        )
    from ..bible.refparser import verse_ordinals
    from .key_verses import TOPIC_KEY_VERSES

    rows = []
    for slug, refs in TOPIC_KEY_VERSES.items():
        for ref in refs:
            rng = B.parse_canonical_range(ref)
            if not rng:
                raise ValueError(f"invalid key verse {ref} for topic {slug}")
            for ordinal in verse_ordinals(*rng)[:8]:
                rows.append({"v": ordinal, "t": f"topic_{slug}", "ref": ref})
    for r in rows:
        execute(session, """INSERT INTO verse_topics (verse_id, topic_id, confidence, provenance)
                            VALUES (:v, :t, 0.85, jsonb_build_object('source', 'curated_topic_index', 'passage', CAST(:ref AS text)))
                            ON CONFLICT (verse_id, topic_id) DO UPDATE SET confidence = EXCLUDED.confidence, provenance = EXCLUDED.provenance""",
                **r)  # curated key verses outrank derived/AI rows that may have taken the (verse, topic) slot
    counts = fetch_all(session, "SELECT (SELECT count(*) FROM topics) AS topics, (SELECT count(*) FROM entities) AS entities, (SELECT count(*) FROM verse_topics WHERE provenance->>'source' = 'curated_topic_index') AS curated_verse_topics")[0]
    load_entities.cache_clear()
    load_topics.cache_clear()
    from .. import cache

    cache.bump_global(session)
    return counts


@lru_cache
def load_entities() -> tuple[EntityDef, ...]:
    out = []
    for key, etype, name, aliases, passages, link, desc in ENTITIES:
        ranges = tuple(r for r in (B.parse_canonical_range(p) for p in passages) if r)
        out.append(EntityDef(f"ent_{key}", etype, name, tuple(aliases), ranges, link, desc))
    return tuple(out)


@lru_cache
def load_topics() -> tuple[tuple[str, str, str, tuple[str, ...]], ...]:
    return tuple((f"topic_{slug}", slug, name, tuple(aliases)) for slug, name, _cat, aliases in TOPICS)


def _alias_pattern(alias: str) -> re.Pattern[str]:
    escaped = re.escape(alias).replace("\\ ", r"[\s\-]+").replace("'", "['’]?")
    return re.compile(rf"(?<![A-Za-z]){escaped}(?![A-Za-z])", re.IGNORECASE)


@lru_cache(maxsize=4096)
def _compiled(alias: str) -> re.Pattern[str]:
    return _alias_pattern(alias)


def find_named_passages(text: str) -> list[dict]:
    """Named stories/passages mentioned in text (contextual reference detector, spec §4.1 step 3)."""
    hits = []
    for ent in load_entities():
        if not ent.link_passages:
            continue
        for alias in sorted(ent.aliases, key=len, reverse=True):
            m = _compiled(alias).search(text)
            if m:
                # multi-word story names are specific; a few biblical names occur in exactly one story
                specificity = 0.9 if len(alias.split()) >= 2 else (0.88 if alias.lower() in UNIQUE_STORY_NAMES else 0.78)
                hits.append({"entity_id": ent.id, "name": ent.name, "alias": alias, "start": m.start(), "end": m.end(), "passages": list(ent.passages), "confidence": specificity})
                break
    return hits


def entities_for_verse(ordinal: int) -> list[EntityDef]:
    return [e for e in load_entities() if any(s <= ordinal <= t for s, t in e.passages)]


def deterministic_tags(text: str, mapped_ordinals: list[int]) -> dict[str, list[dict]]:
    """Keyword/vocabulary fallback tagger used when the AI tagger (P-06) is unavailable."""
    low = text.lower()
    topics = []
    for topic_id, slug, name, aliases in load_topics():
        hits = sum(len(_compiled(a).findall(low)) for a in aliases)
        if hits:
            topics.append({"id": topic_id, "name": name, "confidence": round(min(0.8, 0.55 + 0.08 * hits), 3), "hits": hits})
    topics.sort(key=lambda t: -t["hits"])
    people, places, events, situations, questions = [], [], [], [], []
    for ent in load_entities():
        matched_alias = None
        for alias in ent.aliases:
            m = _compiled(alias).search(text)
            if not m:
                continue
            if ent.type in ("person", "place") and alias.lower() in COMMON_NAMES:
                # common names need a mapped verse inside the entity's passages
                if not any(s <= o <= t for o in mapped_ordinals for s, t in ent.passages):
                    continue
            if ent.type == "person" and not text[m.start()].isupper():
                continue
            matched_alias = alias
            break
        if not matched_alias:
            continue
        item = {"id": ent.id, "name": ent.name, "confidence": 0.7}
        {"person": people, "place": places, "event": events, "life_situation": situations, "question": questions}[ent.type].append(item)
    return {"topics": topics[:5], "people": people, "places": places, "events": events, "life_situations": situations, "questions": questions}

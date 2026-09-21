"""Content-faithful slide deck plan for PREACHING (pure functions).

Port of sermon-builder ``lib/slides/contentPlan.ts`` (buildContentPlan) and the enrichment merge of ``lib/slides/planner.ts``
(visualFromEnrichment, mergeEnrichments). The deck carries the actual sermon onto slides: the scripture text, each point's real
teaching chunked into readable bullets, every application, the conclusion and the prayer. Diagram enrichment only ADDS slides.

Plan JSON keeps the camelCase keys of ``types/slides.ts`` because the web export engine consumes it as-is. Scene visuals get an
``imageKey`` (storage key) once their image exists; ``imageUrl`` is signed from it whenever a plan is served.

Deliberate fixes over the TypeScript original:
* ``ref_of``/``verse_text`` understand grounded scripture (``"John 3:16 — For God so loved…"``) and chapter:verse labels
  (the original took "KJV" from "Psalm 23 (KJV): …" as the reference and cut "John 3:" off "John 3:16 (KJV): …");
* application slides hold at most 5 items each without dropping the rest (the original sliced every group to 5 items).
"""
from __future__ import annotations

import re
from typing import Any

from .grounding import SEPARATOR, parse_reference

_SENTENCE_BREAK = re.compile(r"(?<=[.!?”\"])\s+(?=[A-Z“\"])")
_LEADING_REF = re.compile(r"^([1-3]?\s?[A-Z][A-Za-z]+\.?\s+\d+(?::[\d\-–,:\s]*\d)?)")
_LABEL = re.compile(r"^(.{0,48}?):\s+(.*)$", re.S)
_QUOTES = "\"'“”‘’"
MAX_APPLICATIONS_PER_SLIDE = 5
ENRICHMENT_LIMIT = 3
DIAGRAM_SHAPES = ("hubSpoke", "flow", "compare", "pyramid", "list")


def sentences(text: str | None) -> list[str]:
    return [s.strip() for s in _SENTENCE_BREAK.split(re.sub(r"\s+", " ", text or "")) if s.strip()]


def chunk_by_chars(sents: list[str], max_chars: int) -> list[list[str]]:
    """Group sentences into slide-sized bullets by a character budget so dense passages spread over several slides."""
    groups: list[list[str]] = []
    current: list[str] = []
    count = 0
    for s in sents:
        if current and count + len(s) > max_chars:
            groups.append(current)
            current, count = [s], len(s)
        else:
            current.append(s)
            count += len(s)
    if current:
        groups.append(current)
    return groups


def _grounded_head(scripture: str) -> str | None:
    if SEPARATOR in scripture:
        head = scripture.split(SEPARATOR, 1)[0].strip()
        if parse_reference(head):
            return head
    return None


def ref_of(scripture: str | None) -> str | None:
    """The reference part of a scripture field ('John 3:16 — For God…' / 'Romans 8:28 (NIV): And…' / 'The vine (John 15:5)')."""
    text = (scripture or "").strip()
    if not text:
        return None
    grounded = _grounded_head(text)
    if grounded:
        return grounded
    lead = _LEADING_REF.match(text)
    if lead:
        return lead.group(1).strip().rstrip(":,-– ")
    for inner in re.findall(r"\(([^)]+)\)", text):
        if parse_reference(inner):
            return inner.strip()
    return None


def verse_text(scripture: str | None) -> str:
    """The verse wording of a scripture field, without a leading reference label and surrounding quotes."""
    text = (scripture or "").strip()
    if _grounded_head(text):
        body = text.split(SEPARATOR, 1)[1]
    else:
        label = _LABEL.match(text)
        body = label.group(2) if label and (parse_reference(label.group(1)) or re.search(r"\d", label.group(1))) else text
    body = body.strip()
    if body[:1] in _QUOTES:
        body = body[1:]
    if body[-1:] in _QUOTES:
        body = body[:-1]
    return body.strip()


def _slide(**fields: Any) -> dict[str, Any]:
    """A slide without unset (None) fields, like the TypeScript objects with ``undefined`` members."""
    return {k: v for k, v in fields.items() if v is not None}


def scene(subject: str, high_quality: bool = False) -> dict[str, Any]:
    return {"type": "scene", "spec": subject, "prompt": f"A reverent, cinematic fine-art scene evoking {subject.rstrip(' .')}. No text, no letters, no words.",
            "highQuality": high_quality}


def scripture_art(raw: str, max_chars: int = 360) -> dict[str, Any]:
    return {"type": "scriptureArt", "scripture": {"text": verse_text(raw)[:max_chars], "reference": ref_of(raw) or ""}}


def no_visual() -> dict[str, Any]:
    return {"type": "none"}


def build_content_plan(s: dict[str, Any], theme_id: str, target_slide_count: int | None = None) -> dict[str, Any]:
    target = max(10, min(40, target_slide_count if target_slide_count is not None else 16))
    # a denser target means fewer slides with more sentences each
    budget = 420 if target <= 12 else 340 if target <= 16 else 280
    title = s.get("title") or ""
    mood = s.get("theme") or title
    scripture = s.get("scripture") or ""
    slides: list[dict[str, Any]] = []

    # cover
    slides.append(_slide(layout="cover", role="cover", emphasis="climax", kicker="Sermon", heading=title, subheading=s.get("theme") or None,
                         reference=(ref_of(scripture) or scripture.split("\n")[0][:50]) if scripture else None, visual=scene(mood, True)))

    # key scripture (actual passage text)
    if scripture:
        ref = ref_of(scripture)
        slides.append(_slide(layout="scripture", role="scripture", emphasis="breath", kicker="Scripture", heading=ref or "Scripture", reference=ref,
                             visual=scripture_art(scripture)))

    # introduction (real text)
    for gi, group in enumerate(chunk_by_chars(sentences(s.get("introduction")), budget)[:3]):
        slides.append(_slide(layout="figure" if gi == 0 else "split", role="teaching", emphasis="normal", imageSide="right", kicker="Introduction",
                             heading="Where We Begin" if gi == 0 else "Introduction", body=group,
                             visual=scene(f"{mood}, opening mood") if gi == 0 else no_visual()))

    # main points (real teaching, chunked)
    for i, point in enumerate(s.get("main_points") or [], start=1):
        heading = point.get("heading") or f"Point {i}"
        slides.append(_slide(layout="sectionDivider", role="section", emphasis="normal", kicker=f"Point {i}", heading=heading, visual=scene(heading)))
        if point.get("scripture"):
            ref = ref_of(point["scripture"])
            slides.append(_slide(layout="scripture", role="scripture", emphasis="breath", kicker="Scripture", heading=ref or "Scripture", reference=ref,
                                 visual=scripture_art(point["scripture"], 300)))
        for gi, group in enumerate(chunk_by_chars(sentences(point.get("body")), budget)):
            slides.append(_slide(layout="figure" if gi % 2 == 0 else "split", role="teaching", emphasis="normal", imageSide="right" if gi % 2 == 0 else "left",
                                 kicker=f"Point {i}", heading=heading if gi == 0 else f"{heading} (continued)", body=group,
                                 visual=scene(heading) if gi == 0 else no_visual()))

    # application (every item, in full; chunking by characters keeps each application intact)
    apps = [a.strip() for a in s.get("applications") or [] if isinstance(a, str) and a.strip()]
    if apps:
        groups = []
        for group in chunk_by_chars([a + " " for a in apps], 700):
            items = [x.strip() for x in group]
            groups += [items[j:j + MAX_APPLICATIONS_PER_SLIDE] for j in range(0, len(items), MAX_APPLICATIONS_PER_SLIDE)]
        for gi, items in enumerate(groups):
            slides.append(_slide(layout="bento", role="application", emphasis="normal", kicker="Apply This Week",
                                 heading="Living It Out" if gi == 0 else "Living It Out (more)", body=items, visual=no_visual()))

    # conclusion (real text)
    for gi, group in enumerate(chunk_by_chars(sentences(s.get("conclusion")), budget + 80)[:2]):
        slides.append(_slide(layout="figure" if gi == 0 else "split", role="teaching", emphasis="normal", imageSide="left", kicker="Conclusion",
                             heading="Bringing It Home" if gi == 0 else "Conclusion", body=group,
                             visual=scene(f"{mood}, resolution") if gi == 0 else no_visual()))

    # closing prayer
    prayer = s.get("prayer") or ""
    slides.append(_slide(layout="closing", role="prayer" if prayer else "closing", emphasis="climax", kicker="Closing Prayer" if prayer else "Benediction",
                         heading="Let Us Pray" if prayer else "Go in Peace", body=sentences(prayer)[:4] if prayer else None,
                         visual=scene(f"{mood}, peaceful benediction")))

    return {"meta": {"title": title, "theme": theme_id, "generatedFor": "content"}, "slides": slides}


# ---------------------------------------------------------------------------------------------- diagram enrichment
def _clean(items: list[dict[str, Any]] | None, key: str, fields: tuple[str, ...]) -> list[dict[str, Any]]:
    out = []
    for item in items or []:
        if isinstance(item, dict) and str(item.get(key) or "").strip():
            out.append({f: item[f] for f in fields if item.get(f) not in (None, "")})
    return out


def visual_from_enrichment(e: dict[str, Any]) -> dict[str, Any] | None:
    """An S-05 enrichment item (snake_case) -> a slide visual (camelCase), or None when its payload is too thin to draw."""
    kind = e.get("kind")
    caption = (e.get("caption") or "").strip() or None
    if kind == "map":
        places = _clean(e.get("places"), "name", ("name", "note"))
        if places:
            return _slide(type="map", places=places, spec=caption)
    elif kind == "route":
        stops = _clean(e.get("route_stops") or e.get("routeStops"), "name", ("name", "order", "note"))
        if len(stops) >= 2:
            return _slide(type="route", routeStops=stops, spec=caption)
    elif kind == "timeline":
        events = _clean(e.get("events"), "label", ("label", "date", "note"))
        if len(events) >= 2:
            return _slide(type="timeline", events=events[:5], spec=caption)
    elif kind == "diagram" and isinstance(e.get("diagram"), dict):
        d = e["diagram"]
        shape = d.get("shape") if d.get("shape") in DIAGRAM_SHAPES else "list"
        nodes = _clean(d.get("nodes"), "label", ("label", "detail"))
        left = [str(x).strip() for x in d.get("left_items") or d.get("leftItems") or [] if str(x).strip()]
        right = [str(x).strip() for x in d.get("right_items") or d.get("rightItems") or [] if str(x).strip()]
        ok = bool(left or right) if shape == "compare" else len(nodes) >= 2
        if ok:
            diagram = _slide(shape=shape, center=(d.get("center") or None), nodes=nodes,
                             leftHeader=(d.get("left_header") or d.get("leftHeader") or None), rightHeader=(d.get("right_header") or d.get("rightHeader") or None),
                             leftItems=left or None, rightItems=right or None)
            return _slide(type="diagram", diagram=diagram, spec=caption)
    return None


def merge_enrichments(plan: dict[str, Any], items: list[dict[str, Any]]) -> dict[str, Any]:
    """Insert each enrichment slide right after the divider of the point it illustrates (after the cover + opening scripture for
    sermon-wide items). Processed from the last point backwards so earlier insert positions stay valid."""
    if not items:
        return plan
    slides = list(plan.get("slides") or [])
    dividers = [i for i, s in enumerate(slides) if s.get("role") == "section"]
    for e in sorted(items[:ENRICHMENT_LIMIT], key=lambda x: -int(x.get("point") or 0)):
        visual = visual_from_enrichment(e)
        if not visual:
            continue
        point = int(e.get("point") or 0)
        slide = {
            "layout": "timelineSlide" if visual["type"] == "timeline" else "threeCol" if visual["type"] == "diagram" else "split",
            "role": "illustration", "emphasis": "normal", "kicker": f"Point {point}" if point > 0 else "Context",
            "heading": (e.get("heading") or "").strip() or "A Closer Look", "visual": visual,
        }
        at = dividers[point - 1] + 1 if 1 <= point <= len(dividers) else min(2, len(slides))
        slides.insert(at, slide)
    return {**plan, "slides": slides}


def scene_key(slide: dict[str, Any]) -> str:
    """Slides that show the same scene subject share (and reuse) one generated image."""
    visual = slide.get("visual") or {}
    return str(visual.get("spec") or slide.get("heading") or "").lower().strip()

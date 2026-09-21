"""Ask AI: contextual Q&A seeded with the selected verse and mapped resources (spec §2.3), grounded citations only."""
from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from ..ai.llm import AIInvalidOutput, AIUnavailable, get_llm
from ..ai.schemas import AskOut
from ..bible import books as B
from ..db import execute, json_dumps
from ..security import Viewer
from . import related
from .intelligence import resolve_ref, visible_cards
from .resources import Forbidden


def ask(session: Session, viewer: Viewer, ref: str, question: str, translation: str = "web") -> dict[str, Any]:
    llm = get_llm()
    if not llm.available:
        raise Forbidden("Ask AI needs the Gemini API key to be configured on the server.")
    question = question.strip()[:800]
    if len(question) < 3:
        raise ValueError("please ask a question")
    start, end = resolve_ref(ref)
    code, ch, v = B.from_ordinal(start)
    lo = B.ordinal(code, ch, max(1, v - 2))
    ecode, ech, ev = B.from_ordinal(end)
    hi = B.ordinal(ecode, ech, min(B.verse_count(ecode, ech), ev + 2))
    from .bible import verse_texts_for_range

    context_verses = verse_texts_for_range(session, lo, hi, translation)
    cards = visible_cards(session, viewer, start, end)[:6]
    rel = related.related_verses(session, viewer, start, end, limit=6)
    allowed_verses = {x["ref"] for x in context_verses} | {r["ref"] for r in rel} | {B.canonical_range_str(start, end if end != start else None)}
    allowed_segments = {c["segment_id"] for c in cards}
    variables = {
        "verse_ref": f"{B.canonical_range_str(start, end if end != start else None)} ({B.display_ref(start, end if end != start else None)})",
        "verse_context": "\n".join(f"{x['ref']}: {x['text']}" for x in context_verses),
        "related_verses": "\n".join(f"{r['ref']} ({r['label']}): {r['text'][:300]}" for r in rel) or "(none)",
        "resources": "\n".join(
            f"{c['segment_id']} | {c['resource']['title']} ({c['resource']['type']}) | {c['relationship']['label']} | {(c.get('summary') or '')} | evidence: {(c.get('evidence_text') or '')[:300]}"
            for c in cards) or "(no mapped resources)",
        "question": question,
    }
    try:
        result = llm.run("P-14", variables, AskOut, use_cache=True)
    except (AIUnavailable, AIInvalidOutput) as exc:
        raise Forbidden(f"Ask AI is temporarily unavailable: {exc}") from exc
    out = result.output
    citations = []
    dropped = []
    for c in out.citations:
        if c.kind == "verse":
            rng = B.parse_canonical_range(c.id)
            canon = B.canonical_range_str(rng[0], rng[1] if rng[1] != rng[0] else None) if rng else None
            if canon and (canon in allowed_verses or any(B.parse_canonical_range(a) and B.parse_canonical_range(a)[0] <= rng[0] <= B.parse_canonical_range(a)[1] for a in allowed_verses)):
                citations.append({"kind": "verse", "id": canon, "label": B.display_ref(rng[0], rng[1] if rng[1] != rng[0] else None)})
            else:
                dropped.append(c.id)
        elif c.id in allowed_segments:
            card = next(x for x in cards if x["segment_id"] == c.id)
            citations.append({"kind": "segment", "id": c.id, "label": card["resource"]["title"], "resource_id": card["resource"]["id"], "media_kind": card["media_kind"]})
        else:
            dropped.append(c.id)
    execute(session, "INSERT INTO analytics_events (type, user_id, payload) VALUES ('ask', :u, CAST(:p AS jsonb))",
            u=viewer.user_id, p=json_dumps({"ref": ref, "question_len": len(question), "citations": len(citations), "dropped": len(dropped)}))
    return {
        "answer": out.answer, "citations": citations, "interpretive_note": out.interpretive_note, "confidence": out.confidence,
        "ungrounded_citations_removed": dropped, "provenance": result.provenance(),
        "disclaimer": "AI-generated from the verse text and library resources shown here. It is not an authoritative interpretation.",
    }

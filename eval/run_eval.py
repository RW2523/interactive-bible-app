"""Scripture-tagging evaluation harness (spec §16).

Runs the real detector -> merge -> classify -> audit -> routing stages on every item of
eval/gold/gold_set.json and scores the user-visible mappings; also checks the processed demo
resources against eval/gold/demo_resources_expected.json.

    cd backend && PYTHONPATH=. .venv/bin/python ../eval/run_eval.py --mode deterministic
    cd backend && PYTHONPATH=. .venv/bin/python -m interactive_bible.cli eval --mode ai      # needs GEMINI_API_KEY

Precision is measured first (spec §16.1): a false verse mapping is worse than a missed weak one.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

EVAL_DIR = Path(__file__).resolve().parent
ROOT = EVAL_DIR.parent
sys.path.insert(0, str(ROOT / "backend"))

from interactive_bible.ai.llm import AIUnavailable, get_llm  # noqa: E402
from interactive_bible.bible import books as B  # noqa: E402
from interactive_bible.bible.text import sentence_split  # noqa: E402
from interactive_bible.db import fetch_all, session_scope  # noqa: E402
from interactive_bible.pipeline import detectors, enrich, merge, routing  # noqa: E402
from interactive_bible.pipeline.types import SegmentWork  # noqa: E402
from interactive_bible.retrieval.quotes import get_quote_index  # noqa: E402

VISIBLE = ("published", "approved")
EXPLICIT_CATS = {"explicit_written", "explicit_spoken", "context_inferred", "asr_errors"}
QUOTE_CATS = {"exact_quotes", "paraphrases", "multi_quote"}
RESOURCE = {"id": "eval", "is_official": False, "requires_review": False, "topic_hints": [], "visibility": "public"}
THRESHOLDS = {
    "deterministic": {"explicit_precision": 0.95, "hard_negative_fp_rate": 0.0, "quote_precision": 0.90, "forbidden_violations": 0},
    "ai": {"explicit_precision": 0.95, "hard_negative_fp_rate": 0.0, "quote_precision": 0.90, "semantic_precision": 0.60, "forbidden_violations": 0},
}


@dataclass
class Pred:
    start: int
    end: int
    type: str
    confidence: float
    status: str
    evidence: str

    @property
    def ref(self) -> str:
        return B.canonical_range_str(self.start, self.end if self.end != self.start else None)


@dataclass
class ItemResult:
    id: str
    category: str
    text: str
    expected: list[dict[str, Any]]
    predictions: list[Pred]
    matched: list[tuple[dict[str, Any], Pred]] = field(default_factory=list)
    missed: list[dict[str, Any]] = field(default_factory=list)
    false_positives: list[Pred] = field(default_factory=list)
    forbidden_hits: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)
    seconds: float = 0.0


def rng(ref: str) -> tuple[int, int]:
    r = B.parse_canonical_range(ref)
    if not r:
        raise ValueError(f"invalid gold reference {ref}")
    return r


def overlaps(a: tuple[int, int], b: tuple[int, int]) -> bool:
    return B.from_ordinal(a[0])[0] == B.from_ordinal(b[0])[0] and a[0] <= b[1] and b[0] <= a[1]


def build_segment(item: dict[str, Any]) -> SegmentWork:
    text = item["text"]
    units = [{"id": f"u{i:04d}", "start": s, "end": e, "start_ms": None, "end_ms": None, "page": None, "speaker": None, "kind": "sentence"}
             for i, (s, e) in enumerate(sentence_split(text) or [(0, len(text))], start=1)]
    ctx = item.get("context_before") or ""
    return SegmentWork(
        id=f"eval_{item['id']}", ordinal=0, text=text, transcript_raw=text, unit_ids=[u["id"] for u in units], unit_offsets=units,
        start_ms=None, end_ms=None, page_start=None, page_end=None, char_start=0, char_end=len(text), heading=None, speaker=None,
        context_before=ctx, context_after="", preceding_text=ctx,
    )


def run_item(item: dict[str, Any], ai: bool, qindex) -> ItemResult:
    t0 = time.monotonic()
    seg = build_segment(item)
    dets = detectors.detect_explicit(seg, RESOURCE, "eval", ai)
    quotes, theme_only, raw = detectors.detect_quotes(seg, qindex, RESOURCE, "eval", ai)
    dets += quotes
    dets += detectors.detect_contextual(seg, [], raw, {(d.start, d.end) for d in dets})
    if ai:
        try:
            vectors, model = get_llm().embed([seg.text], "RETRIEVAL_QUERY")
            seg.embeddings["query"] = (model, vectors[0])
        except AIUnavailable as exc:
            seg.notes.append(f"embedding unavailable: {exc}")
        dets += detectors.detect_semantic(seg, RESOURCE, "eval", list(dets), theme_only, [])
    mappings = merge.merge_detections(seg, dets)
    merge.classify_and_select_primary(seg, mappings, RESOURCE, "eval", ai, media=False)
    seg.mappings = mappings
    if ai:
        enrich.audit_segment(seg, RESOURCE, "eval", ai)
    merge.apply_semantic_precision_policy(seg)
    preds = []
    for m in mappings:
        status, _needs, _reasons = routing.route(m.confidence, m.needs_review, m.review_reasons, RESOURCE)
        preds.append(Pred(m.start, m.end, m.type, m.confidence, status, m.evidence_text))
    result = ItemResult(item["id"], item["category"], item["text"], item["expected"], preds, notes=seg.notes)
    visible = [p for p in preds if p.status in VISIBLE]
    used: set[int] = set()
    for exp in item["expected"]:
        er = rng(exp["ref"])
        candidates = [(i, p) for i, p in enumerate(visible) if i not in used and overlaps(er, (p.start, p.end))]
        if not candidates:
            result.missed.append(exp)
            continue
        i, best = max(candidates, key=lambda ip: ((ip[1].start, ip[1].end) == er, ip[1].type == exp["type"], ip[1].confidence))
        used.add(i)
        result.matched.append((exp, best))
    expected_ranges = [rng(e["ref"]) for e in item["expected"]]
    for i, p in enumerate(visible):
        if i not in used and not any(overlaps(er, (p.start, p.end)) for er in expected_ranges):
            result.false_positives.append(p)
    for f in item.get("forbidden") or []:
        fr = rng(f)
        if any(overlaps(fr, (p.start, p.end)) for p in visible):
            result.forbidden_hits.append(f)
    result.seconds = time.monotonic() - t0
    return result


def ratio(n: int, d: int) -> float | None:
    return round(n / d, 4) if d else None


def score(results: list[ItemResult], ai: bool) -> dict[str, Any]:
    visible_all = [(r, p) for r in results for p in r.predictions if p.status in VISIBLE]

    def typed_precision(kind: str) -> tuple[int, int]:
        preds = [(r, p) for r, p in visible_all if p.type == kind]
        correct = sum(1 for r, p in preds if any(m[1] is p for m in r.matched))
        return correct, len(preds)

    def typed_recall(kind: str, cats: set[str] | None) -> tuple[int, int]:
        total = hit = 0
        for r in results:
            if cats and r.category not in cats:
                continue
            for exp in r.expected:
                if exp["type"] != kind:
                    continue
                total += 1
                if any(m[0] is exp and m[1].type == kind for m in r.matched):
                    hit += 1
        return hit, total

    ex_c, ex_n = typed_precision("direct_reference")
    ex_h, ex_t = typed_recall("direct_reference", None)
    q_c, q_n = typed_precision("scripture_quote")
    q_h, q_t = typed_recall("scripture_quote", None)
    nc_h, nc_t = typed_recall("contextual_reference", None)
    s_c, s_n = typed_precision("ai_related")
    s_h, s_t = typed_recall("ai_related", {"semantic"})
    matched_pairs = [m for r in results for m in r.matched]
    cls_ok = sum(1 for exp, p in matched_pairs if exp["type"] == p.type)
    exact_ranges = sum(1 for exp, p in matched_pairs if rng(exp["ref"]) == (p.start, p.end))
    hard = [r for r in results if r.category == "hard_negatives"]
    hard_fp = sum(1 for r in hard if any(p.status in VISIBLE for p in r.predictions))
    total_expected = sum(len(r.expected) for r in results)
    total_matched = len(matched_pairs)
    total_visible = len(visible_all)
    total_fp = sum(len(r.false_positives) for r in results)
    per_category: dict[str, dict[str, Any]] = {}
    for r in results:
        c = per_category.setdefault(r.category, {"items": 0, "expected": 0, "matched": 0, "false_positives": 0, "perfect_items": 0})
        c["items"] += 1
        c["expected"] += len(r.expected)
        c["matched"] += len(r.matched)
        c["false_positives"] += len(r.false_positives)
        c["perfect_items"] += int(not r.missed and not r.false_positives and not r.forbidden_hits)
    for c in per_category.values():
        c["recall"] = ratio(c["matched"], c["expected"])
    return {
        "explicit_precision": ratio(ex_c, ex_n), "explicit_recall": ratio(ex_h, ex_t),
        "quote_precision": ratio(q_c, q_n), "quote_recall": ratio(q_h, q_t),
        "narrative_context_recall": ratio(nc_h, nc_t),
        "semantic_precision": ratio(s_c, s_n) if ai else None, "semantic_recall": ratio(s_h, s_t) if ai else None,
        "relationship_classification_accuracy": ratio(cls_ok, len(matched_pairs)),
        "exact_range_rate": ratio(exact_ranges, len(matched_pairs)),
        "hard_negative_fp_rate": ratio(hard_fp, len(hard)),
        "forbidden_violations": sum(len(r.forbidden_hits) for r in results),
        "overall_precision": ratio(total_visible - total_fp, total_visible), "overall_recall": ratio(total_matched, total_expected),
        "counts": {"items": len(results), "expected_refs": total_expected, "visible_predictions": total_visible, "matched": total_matched, "false_positives": total_fp},
        "per_category": per_category,
    }


def evaluate_demo_resources() -> dict[str, Any]:
    path = EVAL_DIR / "gold" / "demo_resources_expected.json"
    if not path.exists():
        return {"skipped": "no demo expectations file"}
    expectations = json.loads(path.read_text())
    out: dict[str, Any] = {"resources": [], "expected": 0, "detected": 0, "type_correct": 0, "forbidden_violations": 0}
    with session_scope() as s:
        for exp in expectations:
            rows = fetch_all(s, """SELECT l.verse_id, l.end_verse_id, l.relationship_type, l.confidence, l.review_status
                                   FROM verse_resource_links l JOIN resources r ON r.id = l.resource_id
                                   WHERE r.metadata->>'demo_key' = :k AND r.deleted_at IS NULL AND l.parent_link_id IS NULL
                                     AND l.review_status IN ('published', 'approved', 'pending_review')""", k=exp["resource_key"])
            if not rows:
                out["resources"].append({"resource_key": exp["resource_key"], "skipped": "not processed in this database"})
                continue
            found, missing = [], []
            for e in exp["expected"]:
                er = rng(e["ref"])
                hit = next((r for r in rows if overlaps(er, (r["verse_id"], r["end_verse_id"] or r["verse_id"]))), None)
                out["expected"] += 1
                if hit:
                    out["detected"] += 1
                    out["type_correct"] += int(hit["relationship_type"] == e["type"])
                    found.append({"ref": e["ref"], "expected_type": e["type"], "got": B.canonical_range_str(hit["verse_id"], hit["end_verse_id"]), "type": hit["relationship_type"], "status": hit["review_status"]})
                else:
                    missing.append(e)
            bad = [B.canonical_range_str(r["verse_id"], r["end_verse_id"]) for r in rows if B.from_ordinal(r["verse_id"])[0] in (exp.get("forbidden_books") or [])]
            out["forbidden_violations"] += len(bad)
            out["resources"].append({"resource_key": exp["resource_key"], "found": found, "missing": missing, "forbidden_book_hits": bad, "mappings_in_db": len(rows)})
    out["recall"] = ratio(out["detected"], out["expected"])
    out["type_accuracy"] = ratio(out["type_correct"], out["detected"])
    return out


def to_markdown(report: dict[str, Any], results: list[ItemResult]) -> str:
    m = report["metrics"]
    lines = [f"# Scripture tagging evaluation — {report['mode']} mode", "", f"Run at {report['started_at']} · {m['counts']['items']} gold items · pipeline {report['pipeline_version']}", ""]
    lines += ["| Metric | Value | Threshold |", "|---|---|---|"]
    for key in ("explicit_precision", "explicit_recall", "quote_precision", "quote_recall", "narrative_context_recall", "semantic_precision", "semantic_recall",
                "relationship_classification_accuracy", "exact_range_rate", "hard_negative_fp_rate", "forbidden_violations", "overall_precision", "overall_recall"):
        th = report["thresholds"].get(key)
        lines.append(f"| {key} | {m.get(key) if m.get(key) is not None else '–'} | {th if th is not None else ''} |")
    lines += ["", "## Per category", "", "| Category | Items | Expected | Matched | Recall | False positives | Perfect items |", "|---|---|---|---|---|---|---|"]
    for cat, c in sorted(m["per_category"].items()):
        lines.append(f"| {cat} | {c['items']} | {c['expected']} | {c['matched']} | {c['recall'] if c['recall'] is not None else '–'} | {c['false_positives']} | {c['perfect_items']} |")
    lines += ["", "## Failures", ""]
    failures = [r for r in results if r.missed or r.false_positives or r.forbidden_hits or any(e["type"] != p.type for e, p in r.matched)]
    if not failures:
        lines.append("None 🎉")
    for r in failures:
        lines.append(f"- **{r.id}** ({r.category}): “{r.text[:140]}”")
        for e in r.missed:
            lines.append(f"  - missed `{e['ref']}` ({e['type']})")
        for p in r.false_positives:
            lines.append(f"  - false positive `{p.ref}` ({p.type}, {p.confidence:.2f}, {p.status})")
        for e, p in r.matched:
            if e["type"] != p.type:
                lines.append(f"  - type `{e['ref']}`: expected {e['type']}, got {p.type}")
        for f in r.forbidden_hits:
            lines.append(f"  - forbidden reference present `{f}`")
    demo = report.get("demo_resources") or {}
    if demo.get("resources"):
        lines += ["", "## Demo resources (processed in the local database)", "", f"Recall {demo.get('recall')} · type accuracy {demo.get('type_accuracy')} · forbidden book hits {demo.get('forbidden_violations')}", ""]
        for res in demo["resources"]:
            if res.get("skipped"):
                lines.append(f"- {res['resource_key']}: {res['skipped']}")
                continue
            lines.append(f"- {res['resource_key']}: found {len(res['found'])}, missing {[e['ref'] for e in res['missing']]}, forbidden {res['forbidden_book_hits']}")
    lines += ["", "## Threshold check", "", "PASS" if report["passed"] else "FAIL: " + "; ".join(report["violations"])]
    return "\n".join(lines) + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Scripture tagging evaluation harness")
    parser.add_argument("--mode", choices=["auto", "deterministic", "ai"], default="auto")
    parser.add_argument("--limit", type=int, default=0, help="only the first N gold items")
    parser.add_argument("--category", default="", help="comma separated categories to include")
    parser.add_argument("--no-exit", action="store_true", help="do not exit non-zero when thresholds fail")
    args = parser.parse_args(argv)
    llm = get_llm()
    mode = args.mode
    if mode == "auto":
        mode = "ai" if llm.available else "deterministic"
    if mode == "ai" and not llm.available:
        print("AI mode needs GEMINI_API_KEY in .env (or run with --mode deterministic).", file=sys.stderr)
        return 2
    ai = mode == "ai"
    gold = json.loads((EVAL_DIR / "gold" / "gold_set.json").read_text())
    if args.category:
        cats = set(args.category.split(","))
        gold = [g for g in gold if g["category"] in cats]
    if args.limit:
        gold = gold[: args.limit]
    started = datetime.now(timezone.utc)
    with session_scope() as s:
        qindex = get_quote_index(s)
    results = []
    for item in gold:
        if not ai and item["category"] == "semantic":
            continue  # semantic relationships require the AI stages
        results.append(run_item(item, ai, qindex))
    metrics = score(results, ai)
    from interactive_bible.config import get_settings

    report: dict[str, Any] = {
        "mode": mode, "started_at": started.isoformat(), "pipeline_version": get_settings().pipeline_version,
        "models": {"analysis": get_settings().gemini_model_analysis, "embedding": get_settings().gemini_embed_model} if ai else None,
        "metrics": metrics, "thresholds": THRESHOLDS[mode], "demo_resources": evaluate_demo_resources(),
        "items": [{"id": r.id, "category": r.category, "expected": r.expected, "predictions": [p.__dict__ | {"ref": p.ref} for p in r.predictions],
                   "missed": r.missed, "false_positives": [p.ref for p in r.false_positives], "forbidden_hits": r.forbidden_hits, "notes": r.notes, "seconds": round(r.seconds, 3)} for r in results],
    }
    violations = []
    for key, limit in THRESHOLDS[mode].items():
        value = metrics.get(key)
        if value is None:
            continue
        if key in ("hard_negative_fp_rate", "forbidden_violations"):
            if value > limit:
                violations.append(f"{key}={value} > {limit}")
        elif value < limit:
            violations.append(f"{key}={value} < {limit}")
    report["violations"] = violations
    report["passed"] = not violations

    stamp = started.strftime("%Y%m%dT%H%M%SZ")
    out_dir = EVAL_DIR / "reports"
    out_dir.mkdir(exist_ok=True)
    (out_dir / f"eval_{mode}_{stamp}.json").write_text(json.dumps(report, indent=2, default=str))
    md = to_markdown(report, results)
    (out_dir / f"eval_{mode}_{stamp}.md").write_text(md)

    print(f"\nScripture tagging evaluation ({mode}) — {len(results)} items")
    for key in ("explicit_precision", "explicit_recall", "quote_precision", "quote_recall", "narrative_context_recall", "semantic_precision", "semantic_recall",
                "relationship_classification_accuracy", "exact_range_rate", "hard_negative_fp_rate", "forbidden_violations", "overall_precision", "overall_recall"):
        value = metrics.get(key)
        if value is not None:
            print(f"  {key:<38} {value}")
    demo = report["demo_resources"]
    if demo.get("expected"):
        print(f"  {'demo_resources_recall':<38} {demo['recall']}  (type accuracy {demo['type_accuracy']}, forbidden {demo['forbidden_violations']})")
    print(f"\nreport: eval/reports/eval_{mode}_{stamp}.md")
    print("PASS" if report["passed"] else "FAIL: " + "; ".join(violations))
    return 0 if (report["passed"] or args.no_exit) else 1


if __name__ == "__main__":
    sys.exit(main())

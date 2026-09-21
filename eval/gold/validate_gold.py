#!/usr/bin/env python3
"""Validate the Bible-tagger evaluation gold data (standard library only).

Usage (from the project root):
    python3 eval/gold/validate_gold.py [--gold eval/gold/gold_set.json]
                                       [--demo eval/gold/demo_resources_expected.json]

Checks for gold_set.json:
  * every item has id/category/text/context_before/expected/forbidden/notes with the right types
  * ids are unique and category counts meet the minimums
  * every ref (expected and forbidden) is BOOK.C.V or BOOK.C.V-BOOK.C.V with a USFM book code,
    exists in data/bible/engwebp_vpl.txt, and ranges stay in one book and are ordered
  * every evidence string is an exact substring of the item text
  * relationship types are valid and consistent with the category
  * forbidden refs never overlap expected refs; hard negatives expect nothing and forbid something
  * exact_quotes / multi_quote evidence really is WEB, KJV or ASV wording of the ref
    (KJV [italic] brackets and pilcrows removed); paraphrase evidence is not verbatim
  * hard_negatives and semantic texts share no 6-word run with any of the three translations

Checks for demo_resources_expected.json (skipped if the file is absent):
  * text_path exists, refs are valid, evidence strings are exact substrings of the text,
    forbidden_books are USFM codes that no expected ref uses

Exits 1 if any check fails.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
BIBLE_DIR = ROOT / "data" / "bible"
TRANSLATIONS = {
    "WEB": BIBLE_DIR / "engwebp_vpl.txt",
    "KJV": BIBLE_DIR / "eng-kjv2006_vpl.txt",
    "ASV": BIBLE_DIR / "eng-asv_vpl.txt",
}

USFM_BOOKS = (
    "GEN EXO LEV NUM DEU JOS JDG RUT 1SA 2SA 1KI 2KI 1CH 2CH EZR NEH EST JOB PSA PRO ECC SNG ISA JER "
    "LAM EZK DAN HOS JOL AMO OBA JON MIC NAM HAB ZEP HAG ZEC MAL MAT MRK LUK JHN ACT ROM 1CO 2CO GAL "
    "EPH PHP COL 1TH 2TH 1TI 2TI TIT PHM HEB JAS 1PE 2PE 1JN 2JN 3JN JUD REV"
).split()
USFM_TO_VPL = {
    "JHN": "JOH", "MRK": "MAR", "PHP": "PHI", "JAS": "JAM", "SNG": "SOL", "EZK": "EZE",
    "JOL": "JOE", "NAM": "NAH", "1JN": "1JO", "2JN": "2JO", "3JN": "3JO",
}
VPL_TO_USFM = {vpl: usfm for usfm, vpl in USFM_TO_VPL.items()}

CATEGORY_MINIMUMS = {
    "explicit_written": 10,
    "explicit_spoken": 10,
    "context_inferred": 4,
    "asr_errors": 5,
    "exact_quotes": 6,
    "paraphrases": 5,
    "narrative_context": 5,
    "semantic": 5,
    "hard_negatives": 10,
    "multi_quote": 2,
}
CATEGORY_TYPE = {
    "explicit_written": "direct_reference",
    "explicit_spoken": "direct_reference",
    "context_inferred": "direct_reference",
    "asr_errors": "direct_reference",
    "exact_quotes": "scripture_quote",
    "paraphrases": "scripture_quote",
    "multi_quote": "scripture_quote",
    "narrative_context": "contextual_reference",
    "semantic": "ai_related",
}
TYPES = {"direct_reference", "scripture_quote", "contextual_reference", "ai_related"}
ITEM_FIELDS = {"id": str, "category": str, "text": str, "context_before": str,
               "expected": list, "forbidden": list, "notes": str}
NGRAM = 6

_VERSE_RE = re.compile(r"^([1-3]?[A-Z]{2,3})\.(\d+)\.(\d+)$")
_VPL_LINE = re.compile(r"^(\S+) (\d+):(\d+) (.*)$")


class Bible:
    def __init__(self) -> None:
        self.text: dict[str, dict[tuple[str, int, int], str]] = {}
        self.order: dict[tuple[str, int, int], int] = {}
        self.shingles: dict[str, str] = {}
        for name, path in TRANSLATIONS.items():
            if not path.exists():
                sys.exit(f"error: missing Bible text {path}")
            verses = {}
            for line in path.read_text(encoding="utf-8").splitlines():
                match = _VPL_LINE.match(line)
                if not match:
                    continue
                book = VPL_TO_USFM.get(match.group(1), match.group(1))
                key = (book, int(match.group(2)), int(match.group(3)))
                verses[key] = match.group(4)
                if name == "WEB":
                    self.order.setdefault(key, len(self.order))
            self.text[name] = verses
            self.shingles[name] = " " + " ".join(tokens(" ".join(verses.values()))) + " "

    def parse(self, ref: object) -> tuple[int, int]:
        """Return (start, end) positions in WEB canonical order, or raise ValueError."""
        if not isinstance(ref, str) or not ref:
            raise ValueError(f"ref must be a non-empty string, got {ref!r}")
        parts = ref.split("-")
        if len(parts) > 2:
            raise ValueError(f"{ref}: more than one '-'")
        keys = []
        for part in parts:
            match = _VERSE_RE.match(part)
            if not match:
                raise ValueError(f"{ref}: '{part}' is not BOOK.CHAPTER.VERSE")
            book = match.group(1)
            if book not in USFM_BOOKS:
                raise ValueError(f"{ref}: unknown USFM book code '{book}'")
            key = (book, int(match.group(2)), int(match.group(3)))
            if key not in self.order:
                vpl = USFM_TO_VPL.get(book, book)
                raise ValueError(f"{ref}: {vpl} {key[1]}:{key[2]} not found in {TRANSLATIONS['WEB'].name}")
            keys.append(key)
        if len(keys) == 2:
            if keys[0][0] != keys[1][0]:
                raise ValueError(f"{ref}: range crosses books")
            if self.order[keys[0]] >= self.order[keys[1]]:
                raise ValueError(f"{ref}: range start is not before range end")
        return self.order[keys[0]], self.order[keys[-1]]

    def passage(self, translation: str, ref: str) -> str:
        start, end = self.parse(ref)
        keys = [k for k, pos in self.order.items() if start <= pos <= end]
        verses = self.text[translation]
        return " ".join(verses.get(k, "") for k in keys)


def tokens(text: str) -> list[str]:
    text = text.lower().replace("’", "").replace("'", "")
    return re.findall(r"[a-z0-9]+", text)


def clean_verse_markup(text: str) -> str:
    """Drop KJV italic brackets and pilcrows so quotes can be compared as printed."""
    text = text.replace("¶", "").replace("[", "").replace("]", "")
    return re.sub(r"\s+", " ", text).strip()


def overlaps(a: tuple[int, int], b: tuple[int, int]) -> bool:
    return a[0] <= b[1] and b[0] <= a[1]


def validate_gold(bible: Bible, path: Path) -> tuple[list[str], Counter, int]:
    errors: list[str] = []
    try:
        items = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        return [f"{path}: cannot load JSON: {exc}"], Counter(), 0
    if not isinstance(items, list):
        return [f"{path}: top level must be a JSON array"], Counter(), 0

    seen_ids: set[str] = set()
    counts: Counter = Counter()
    ref_total = 0
    for index, item in enumerate(items):
        where = f"item[{index}]"
        if not isinstance(item, dict):
            errors.append(f"{where}: must be an object")
            continue
        where = f"{item.get('id', where)}"
        bad_fields = False
        for field, kind in ITEM_FIELDS.items():
            if not isinstance(item.get(field), kind):
                errors.append(f"{where}: field '{field}' missing or not {kind.__name__}")
                bad_fields = True
        extra = set(item) - set(ITEM_FIELDS)
        if extra:
            errors.append(f"{where}: unexpected field(s) {sorted(extra)}")
        if bad_fields:
            continue

        if not item["id"].strip():
            errors.append(f"{where}: empty id")
        if item["id"] in seen_ids:
            errors.append(f"{where}: duplicate id")
        seen_ids.add(item["id"])

        category, text = item["category"], item["text"]
        if category not in CATEGORY_MINIMUMS:
            errors.append(f"{where}: unknown category '{category}'")
            continue
        counts[category] += 1
        if not text.strip():
            errors.append(f"{where}: empty text")
        if category == "context_inferred" and not item["context_before"].strip():
            errors.append(f"{where}: context_inferred item needs context_before")

        expected_spans = []
        seen_refs = set()
        for n, exp in enumerate(item["expected"]):
            label = f"{where} expected[{n}]"
            if not isinstance(exp, dict) or set(exp) != {"ref", "type", "evidence"}:
                errors.append(f"{label}: must be an object with exactly ref, type, evidence")
                continue
            ref_total += 1
            try:
                expected_spans.append(bible.parse(exp["ref"]))
            except ValueError as exc:
                errors.append(f"{label}: {exc}")
            if exp["ref"] in seen_refs:
                errors.append(f"{label}: duplicate ref {exp['ref']}")
            seen_refs.add(exp["ref"])
            if exp["type"] not in TYPES:
                errors.append(f"{label}: invalid type '{exp['type']}'")
            elif category in CATEGORY_TYPE and exp["type"] != CATEGORY_TYPE[category]:
                errors.append(f"{label}: type '{exp['type']}' inconsistent with category '{category}' "
                              f"(expected '{CATEGORY_TYPE[category]}')")
            evidence = exp["evidence"]
            if not isinstance(evidence, str) or not evidence.strip():
                errors.append(f"{label}: empty evidence")
                continue
            if evidence not in text:
                errors.append(f"{label}: evidence {evidence!r} is not an exact substring of text")
            if category in ("exact_quotes", "multi_quote"):
                try:
                    sources = [t for t in TRANSLATIONS
                               if evidence in clean_verse_markup(bible.passage(t, exp["ref"]))]
                except ValueError:
                    sources = []
                if not sources:
                    errors.append(f"{label}: evidence is not verbatim WEB/KJV/ASV text of {exp['ref']}")
            if category == "paraphrases":
                try:
                    if any(evidence in clean_verse_markup(bible.passage(t, exp["ref"])) for t in TRANSLATIONS):
                        errors.append(f"{label}: paraphrase evidence is verbatim scripture (use exact_quotes)")
                except ValueError:
                    pass

        for n, ref in enumerate(item["forbidden"]):
            label = f"{where} forbidden[{n}]"
            try:
                span = bible.parse(ref)
            except ValueError as exc:
                errors.append(f"{label}: {exc}")
                continue
            if any(overlaps(span, other) for other in expected_spans):
                errors.append(f"{label}: {ref} overlaps an expected ref")

        if category == "hard_negatives":
            if item["expected"]:
                errors.append(f"{where}: hard negative must have expected []")
            if not item["forbidden"]:
                errors.append(f"{where}: hard negative must list at least one forbidden ref")
        elif not item["expected"]:
            errors.append(f"{where}: category '{category}' needs at least one expected ref")
        if category == "multi_quote" and len(item["expected"]) < 2:
            errors.append(f"{where}: multi_quote needs at least two expected refs")

        if category in ("hard_negatives", "semantic"):
            words = tokens(text)
            for i in range(len(words) - NGRAM + 1):
                window = " " + " ".join(words[i:i + NGRAM]) + " "
                hits = [t for t, corpus in bible.shingles.items() if window in corpus]
                if hits:
                    errors.append(f"{where}: {NGRAM}-word run '{window.strip()}' appears verbatim in {'/'.join(hits)}")
                    break

    for category, minimum in CATEGORY_MINIMUMS.items():
        if counts[category] < minimum:
            errors.append(f"category '{category}' has {counts[category]} items, needs at least {minimum}")
    return errors, counts, ref_total


def validate_demo(bible: Bible, path: Path) -> tuple[list[str], int]:
    errors: list[str] = []
    try:
        resources = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        return [f"{path}: cannot load JSON: {exc}"], 0
    manifest_path = ROOT / "demo_content" / "manifest.json"
    manifest_keys = None
    if manifest_path.exists():
        manifest_keys = {entry.get("key") for entry in json.loads(manifest_path.read_text(encoding="utf-8"))}
    refs = 0
    for resource in resources:
        key = resource.get("resource_key", "?")
        if manifest_keys is not None and key not in manifest_keys:
            errors.append(f"demo {key}: not present in demo_content/manifest.json")
        text_path = ROOT / str(resource.get("text_path", ""))
        if not text_path.is_file():
            errors.append(f"demo {key}: text_path {resource.get('text_path')!r} not found")
            continue
        text = text_path.read_text(encoding="utf-8")
        books = set()
        for n, exp in enumerate(resource.get("expected", [])):
            label = f"demo {key} expected[{n}]"
            refs += 1
            try:
                bible.parse(exp.get("ref"))
                books.add(exp["ref"].split(".")[0])
            except ValueError as exc:
                errors.append(f"{label}: {exc}")
            if exp.get("type") not in TYPES:
                errors.append(f"{label}: invalid type {exp.get('type')!r}")
            if not exp.get("evidence") or exp["evidence"] not in text:
                errors.append(f"{label}: evidence {exp.get('evidence')!r} not found verbatim in {text_path.name}")
        for book in resource.get("forbidden_books", []):
            if book not in USFM_BOOKS:
                errors.append(f"demo {key}: forbidden book {book!r} is not a USFM code")
            elif book in books:
                errors.append(f"demo {key}: forbidden book {book} is also expected")
    return errors, refs


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate eval gold data against data/bible.")
    parser.add_argument("--gold", type=Path, default=HERE / "gold_set.json")
    parser.add_argument("--demo", type=Path, default=HERE / "demo_resources_expected.json")
    args = parser.parse_args()

    bible = Bible()
    errors, counts, ref_total = validate_gold(bible, args.gold)
    total = sum(counts.values())
    print(f"{args.gold}: {total} items, {ref_total} expected refs")
    for category, minimum in CATEGORY_MINIMUMS.items():
        status = "ok" if counts[category] >= minimum else "TOO FEW"
        print(f"  {category:<18} {counts[category]:>3}  (min {minimum})  {status}")

    if args.demo.exists():
        demo_errors, demo_refs = validate_demo(bible, args.demo)
        print(f"{args.demo}: {demo_refs} expected refs across demo resources")
        errors += demo_errors

    if errors:
        print(f"\nFAILED with {len(errors)} error(s):")
        for error in errors:
            print(f"  - {error}")
        return 1
    print("\nOK: all checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())

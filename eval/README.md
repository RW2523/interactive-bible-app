# Evaluation (spec §16)

`run_eval.py` runs the real pipeline stages (reference parser → quote index → named passages →
[Gemini: embeddings, P-02/P-03/P-04/P-05/P-12] → merge → confidence routing) on every item of
`gold/gold_set.json` and scores only what a user would actually see (mappings routed to *published*).

```bash
make eval                                                   # auto: AI mode when GEMINI_API_KEY is set
cd backend && PYTHONPATH=. .venv/bin/python ../eval/run_eval.py --mode deterministic
cd backend && PYTHONPATH=. .venv/bin/python ../eval/run_eval.py --mode ai --category paraphrases,semantic
```

Reports are written to `eval/reports/eval_<mode>_<timestamp>.{md,json}` with per-item misses, false
positives, type errors and forbidden-reference hits.

| Metric (§16.2) | How it is measured |
|---|---|
| Explicit reference precision / recall | visible `direct_reference` predictions vs expected, across all items (hard negatives included) |
| Quote identification precision / recall | visible `scripture_quote` predictions vs exact quotes, paraphrases and stitched quotes |
| Semantic mapping precision@K | visible `ai_related` predictions (AI mode only) |
| Relationship classification accuracy | matched references whose predicted type equals the gold type |
| Hard-negative false-positive rate | hard-negative items with any visible mapping (must be 0) |
| Forbidden violations | visible mappings overlapping a gold `forbidden` reference (must be 0) |
| Demo resources | recall/type accuracy of the processed demo resources against `gold/demo_resources_expected.json` |

A predicted passage matches a gold reference when it is in the same book and overlaps it; `exact_range_rate`
reports how often the range is identical. Thresholds (deterministic: explicit precision ≥ 0.95, quote precision
≥ 0.90, zero hard-negative FPs and forbidden hits; AI mode adds semantic precision ≥ 0.60) make the command exit
non-zero on regression. `gold/validate_gold.py` checks the gold set itself (references exist, evidence strings
are exact substrings, category minimums).

Deterministic baseline on this build: explicit P/R 1.00/1.00 · quote P/R 1.00/0.67 · narrative recall 1.00 ·
classification accuracy 1.00 · hard-negative FP 0 · overall P/R 1.00/0.91 (paraphrase and semantic recall require Gemini).

AI mode with live Gemini (Gemini 3.8 Flash / 3.5 Flash-Lite, `gemini-embedding-001`): explicit P/R 1.00/1.00 · quote P/R 1.00/0.67 ·
semantic P/R 0.91/1.00 · classification accuracy 0.92 · hard-negative FP 0 · overall P/R 1.00/1.00 · demo recall 1.00.
The first live run scored semantic precision 0.17 and hard-negative FP 0.15: the model rated thematic neighbours and parallels of
cited passages at 0.80–0.85. The pipeline now shows AI Related only for the strongest supported match (≥ 0.90) and keeps the rest
for search and review — see `apply_semantic_precision_policy` in `backend/interactive_bible/pipeline/merge.py`. Keep an AI-mode run in the loop
when changing prompts or models: the offline fake client cannot measure calibration.

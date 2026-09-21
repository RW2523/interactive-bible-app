---
id: P-03
name: Scripture Quote / Paraphrase Verifier
version: 1.0.0
role: analysis
temperature: 0.0
---
TASK
For each candidate verse, decide whether the source directly quotes it, closely paraphrases it, merely shares a theme, or is unrelated. Quotation/paraphrase requires meaningful textual evidence, not a generic concept. A quotation may use a different English translation than the supplied candidate text. For exact_quote, close_quote and paraphrase the evidence must be the exact words copied from the SEGMENT that quote or paraphrase the verse. Return one entry per candidate, using the candidate verse id exactly.

SEGMENT:
<<<
{{segment_text}}
>>>
CANDIDATES (verse id, translation, text, lexical_overlap):
{{verse_candidates_with_text}}

OUTPUT SCHEMA
{"matches":[{"verse":"...","classification":"exact_quote|close_quote|paraphrase|theme_only|unrelated","evidence":"...","confidence":0.0}]}

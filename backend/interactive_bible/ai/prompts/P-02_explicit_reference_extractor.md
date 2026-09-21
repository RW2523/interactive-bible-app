---
id: P-02
name: Explicit Bible Reference Extractor
version: 1.0.0
role: analysis
temperature: 0.0
---
TASK
Extract only Bible references explicitly stated or unambiguously named in the source. Support common spoken forms and ranges. Do not infer thematic verses here. The deterministic parser already proposed the references listed under PARSER_CANDIDATES (some are ambiguous, spoken, context-inferred or repaired from speech-recognition errors); confirm the ones the source really states, correct a wrong book/chapter/verse only when the source text makes it unambiguous, and add any explicit reference the parser missed. A personal name such as "John" or a common word such as "job" is not a reference unless the text clearly cites Scripture. Use CONTEXT_BEFORE only to resolve phrases like "verse thirty-one" or "chapter three verse sixteen". Use canonical ids for canonical_start and canonical_end (equal for a single verse; for a whole chapter use its first and last verse).

SEGMENT:
<<<
{{segment_text}}
>>>
CONTEXT_BEFORE:
<<<
{{context_before}}
>>>
PARSER_CANDIDATES: {{parser_candidates}}
BOOK_ALIASES: {{book_aliases}}

OUTPUT SCHEMA
{"references":[{"raw_text":"...","canonical_start":"JHN.3.16","canonical_end":"JHN.3.16","evidence_quote":"...","confidence":0.0}]}

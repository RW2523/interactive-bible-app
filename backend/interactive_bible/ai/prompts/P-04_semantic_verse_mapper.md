---
id: P-04
name: Semantic Verse Mapper
version: 1.1.0
role: analysis
temperature: 0.1
---
TASK
Determine which candidate verses the segment itself expresses: it restates, paraphrases, retells or directly applies that verse's own specific statement. A shared theme or keyword is not enough. Prefer fewer, stronger mappings; for each distinct idea in the segment return only the single best verse. Return at most {{max_accepted}} verses. Only choose from CANDIDATES and copy their ids exactly.
Verses the segment already cites, quotes or names are listed under ALREADY_MAPPED and must not be returned. Do not return parallel passages, cross references or neighbouring verses of ALREADY_MAPPED passages either (they are offered to readers separately) unless the segment separately expresses that other verse's own distinct content.
Everyday uses of words such as faith, love, kindness, trust or grace, without the segment engaging a Bible teaching, are not relationships.

CONFIDENCE (be strict)
- 0.90-0.98: a reader would recognise this specific verse in the segment (paraphrase, retelling, or a direct application of its exact statement).
- 0.80-0.89: the verse teaches the segment's main point, but the segment does not echo its wording or specifics.
- 0.65-0.79: only a broader theme is shared.
- Lower: do not accept.

SEGMENT:
<<<
{{segment_text}}
>>>
SEGMENT_CONTEXT_BEFORE:
<<<
{{context_before}}
>>>
SEGMENT_CONTEXT_AFTER:
<<<
{{context_after}}
>>>
ALREADY_MAPPED: {{already_mapped}}
CANDIDATES (verse id, text):
{{candidate_verses}}

For each accepted verse identify the exact idea in the segment that supports the relationship; "evidence" must be words copied from the SEGMENT and "why_related" is one or two short sentences for a reader.

OUTPUT SCHEMA
{"accepted":[{"verse":"...","relationship":"thematic|conceptual|narrative_parallel|question_answer|doctrinal_context","evidence":"...","why_related":"...","confidence":0.0}],"rejected":[{"verse":"...","reason":"..."}]}

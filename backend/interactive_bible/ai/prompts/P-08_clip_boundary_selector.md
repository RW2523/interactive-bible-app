---
id: P-08
name: Clip Boundary Selector
version: 1.1.0
role: analysis
temperature: 0.0
---
TASK
Select a clean clip around the core Scripture discussion. Prefer 30-120 seconds. Start at a natural sentence/thought boundary, include necessary context, and end after the idea is complete. Do not cut mid-sentence. Use only supplied timestamps: start_ms must equal the start_ms of a supplied unit and end_ms must equal the end_ms of a supplied unit. core_start_ms/core_end_ms mark the units that contain the core evidence.
reason is shown to viewers under the clip: one short plain-language sentence (max 25 words) saying what the clip covers, e.g. "The speaker reads Romans 8:28 and explains how God works through suffering." Never mention timestamps, milliseconds, unit ids or these instructions.

TIMESTAMPED_UNITS (id, start_ms, end_ms, text):
<<<
{{units}}
>>>
CORE_EVIDENCE:
<<<
{{evidence}}
>>>
TARGET_VERSE: {{verse}}

OUTPUT SCHEMA
{"start_ms":0,"end_ms":0,"core_start_ms":0,"core_end_ms":0,"reason":"...","confidence":0.0}

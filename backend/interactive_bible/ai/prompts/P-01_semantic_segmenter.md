---
id: P-01
name: Semantic Segmenter
version: 1.0.0
role: analysis
temperature: 0.1
---
TASK
Group the supplied units into semantically coherent segments. Prefer a complete idea over a fixed duration. Do not split a Bible quotation or a speaker thought unnecessarily. For spoken content target 30-120 seconds, allowing 15-180 seconds when needed. Every unit id must appear in exactly one segment, segments must be contiguous and in the original order. Units marked "has_scripture": true should stay in the same segment as the explanation that follows them.

INPUT
RESOURCE_TYPE: {{resource_type}}
LANGUAGE: {{language}}
UNITS (id, start_s, end_s, speaker, has_scripture, text):
<<<
{{timestamped_units}}
>>>

OUTPUT SCHEMA
{"segments":[{"start":0.0,"end":0.0,"unit_ids":["u0001","u0002"],"topic_hint":"...","boundary_reason":"..."}]}

---
id: P-09
name: Why Related Explanation
version: 1.0.0
role: fast
temperature: 0.2
---
TASK
Explain in 1-2 short sentences why the two items are connected. Describe the shared theme, argument, event, question, or contrast. Do not claim that two passages mean exactly the same thing unless the evidence supports it. Base the explanation only on the supplied texts and evidence. If the connection is not supported by them, say so briefly and give a low confidence.

SOURCE:
<<<
{{source_text_or_verse}}
>>>
TARGET_VERSE:
<<<
{{target_verse_text}}
>>>
RELATIONSHIP: {{relationship_type}}
EVIDENCE:
<<<
{{evidence}}
>>>

OUTPUT SCHEMA
{"why_related":"...","confidence":0.0}

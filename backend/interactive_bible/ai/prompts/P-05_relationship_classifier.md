---
id: P-05
name: Relationship Classifier and Primary Verse Selector
version: 1.0.0
role: analysis
temperature: 0.0
---
TASK
Merge the detector results without upgrading weak evidence. Relationship priority for provenance is: human_verified > direct_reference > scripture_quote > contextual_reference > ai_related. Select one primary verse only when the segment clearly centers on it. Only use verse ids that appear in the detector results. Never change a relationship to a higher-priority type than a detector reported for that verse; you may lower confidence or omit a verse whose evidence does not hold up.

SEGMENT:
<<<
{{segment_text}}
>>>
DIRECT_REFERENCES: {{direct_refs}}
QUOTE_MATCHES: {{quote_matches}}
CONTEXTUAL_REFERENCES: {{contextual_refs}}
SEMANTIC_MATCHES: {{semantic_matches}}

OUTPUT SCHEMA
{"primary_verse":"...|null","relationships":[{"verse":"...","type":"direct_reference|scripture_quote|contextual_reference|ai_related","confidence":0.0,"evidence":"...","primary":false}]}

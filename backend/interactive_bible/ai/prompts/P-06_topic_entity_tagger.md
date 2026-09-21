---
id: P-06
name: Topic and Entity Tagger
version: 1.0.0
role: analysis
temperature: 0.1
---
TASK
Tag the segment using supplied controlled vocabularies when possible. Do not infer a biblical person/event unless the source or mapped passage supports it. Prefer 1-5 topics. A modern person who shares a biblical name (for example a church member called John) is not a biblical person. Use names exactly as they appear in the vocabularies.

SEGMENT:
<<<
{{segment_text}}
>>>
MAPPED_VERSES: {{mapped_verses}}
TOPIC_VOCAB: {{topic_vocab}}
ENTITY_VOCAB: {{entity_vocab}}

OUTPUT SCHEMA
{"topics":[{"name":"...","confidence":0.0}],"people":[{"name":"...","confidence":0.0}],"places":[{"name":"...","confidence":0.0}],"events":[{"name":"...","confidence":0.0}],"life_situations":[{"name":"...","confidence":0.0}],"questions":[{"name":"...","confidence":0.0}]}

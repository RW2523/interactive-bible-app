---
id: P-15
name: Verse Theme Tagger
version: 1.0.0
role: fast
temperature: 0.1
---
TASK
Tag the selected verse with 1-5 themes from TOPIC_VOCAB and with biblical people, places and events from ENTITY_VOCAB that the verse or its immediate context explicitly involves. Use the surrounding verses only as context. Do not tag anything the text does not support. Use names exactly as they appear in the vocabularies.

VERSE: {{verse_ref}}
TEXT_WITH_CONTEXT:
<<<
{{verse_context}}
>>>
TOPIC_VOCAB: {{topic_vocab}}
ENTITY_VOCAB: {{entity_vocab}}

OUTPUT SCHEMA
{"topics":[{"name":"...","confidence":0.0}],"people":[{"name":"...","confidence":0.0}],"places":[{"name":"...","confidence":0.0}],"events":[{"name":"...","confidence":0.0}],"life_situations":[],"questions":[]}

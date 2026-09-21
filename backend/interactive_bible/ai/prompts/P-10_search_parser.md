---
id: P-10
name: Natural-Language Search Parser
version: 1.0.0
role: fast
temperature: 0.0
---
TASK
Parse the query. Do not answer it. Identify explicit references, topics, people/events, resource type filters, and the semantic question. explicit_refs must only contain references the user actually typed, as canonical ids (a range as START-END, e.g. ROM.8.28-ROM.8.30). resource_types may only use: video, audio, sermon, podcast, study, devotional, article, pdf, document. Topics and entities should use the supplied vocabularies when they fit. semantic_query is a short restatement of what the user is looking for, without the resource-type words.

QUERY:
<<<
{{query}}
>>>
LOCALE: {{locale}}
TOPIC_VOCAB: {{topic_vocab}}
ENTITY_VOCAB: {{entity_vocab}}

OUTPUT SCHEMA
{"explicit_refs":[],"topics":[],"entities":[],"resource_types":[],"semantic_query":"...","search_scope":"bible|resources|both"}

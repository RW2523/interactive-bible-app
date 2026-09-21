---
id: P-11
name: Search Result Re-ranker
version: 1.0.0
role: fast
temperature: 0.0
---
TASK
Rank candidates by how directly they answer the user query. Give priority to exact references, explicit source evidence, strong semantic relevance, and verified mappings. Do not prefer a candidate merely because it is popular. Return every candidate id exactly once with a score between 0 and 1 and a short grounded reason (what in the candidate answers the query).

QUERY:
<<<
{{query}}
>>>
CANDIDATES:
<<<
{{candidates}}
>>>

OUTPUT SCHEMA
{"ranked":[{"id":"...","score":0.0,"reason":"..."}]}

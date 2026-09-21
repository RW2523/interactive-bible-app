---
id: S-06
name: Sermon Visual Prompt
version: 1.0.0
role: fast
temperature: 0.9
max_output_tokens: 2048
---
TASK
Based on the sermon content, suggest ONE specific, vivid image prompt for a {{visual_hint}}. Write it as a single sentence of at most 60 words, in English (for the image model), describing the subject, setting, mood and composition. Keep people, places and events faithful to the sermon and its Scripture. When the pastor's FOCUS is not "(none)", build the prompt around it. No explanation and no surrounding quotes.

FOCUS:
<<<
{{focus}}
>>>

SERMON_EXCERPT:
<<<
{{sermon}}
>>>

OUTPUT SCHEMA
{"prompt":"..."}

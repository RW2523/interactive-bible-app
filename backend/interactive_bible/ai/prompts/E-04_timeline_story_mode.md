---
id: E-04
name: Timeline Story Mode
version: 1.0.0
role: analysis
temperature: 0.5
---
TASK
Build a guided "story mode" walk through the Bible timeline events below, in the order given. Ground the content only in the supplied event titles, dates and references; do not invent unsupported historical claims. Timeline dates are approximate.
AUDIENCE: {{audience_instruction}}
LENGTH: {{length_instruction}}
- title: a title for the walk.
- narration: a one-paragraph overview of the walk.
- scenes: in timeline order, at most MAX_SCENES scenes; when there are more events than that, keep the most significant ones. Each scene covers one event: eventId copied exactly from that event's id; a short title; imagePrompt describing an illustrated scene of the event (period setting; no text, letters or modern objects); voiceText of 1-3 sentences for the narrator; scriptureReference, the event's reference.

MAX_SCENES: {{max_scenes}}
TIMELINE_EVENTS:
<<<
{{events}}
>>>

OUTPUT SCHEMA
{"title":"...","narration":"...","scenes":[{"eventId":"...","title":"...","imagePrompt":"...","voiceText":"...","scriptureReference":"..."}]}

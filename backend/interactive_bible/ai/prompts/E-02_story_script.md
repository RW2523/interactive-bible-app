---
id: E-02
name: Story Video Script
version: 1.0.0
role: analysis
temperature: 0.7
---
TASK
Write the script for a short narrated story video about the Bible event below. The video shows one illustrated image per scene while the narration plays.
- title: a short title for the video.
- reference: the primary Scripture reference for the event.
- narration: one complete narrator script of 130-200 words, read aloud over the whole video. Reverent, clear and child-friendly; tell the event in order.
- scenes: exactly {{scene_count}} scenes that follow the narration in order. Each scene has a short title; durationSec, a whole number of seconds from 4 to 12, proportional to how much of the narration the scene covers; narration, a 1-2 sentence caption; and imagePrompt, a {{image_hint}}.
- Image prompts describe only what is visible: setting, people, clothing, action, light and mood. Keep people in period dress and settings true to the ancient world of the event; never ask for text, letters, logos or watermarks.
- quiz: 2-3 short questions whose answers come from the event data.
Keep every fact aligned with the Scripture references and the event data; do not add speculative details or doctrine.

SCENE_COUNT: {{scene_count}}
IMAGE_FORMAT: {{image_format}}
EVENT:
<<<
{{event}}
>>>

OUTPUT SCHEMA
{"title":"...","reference":"...","narration":"...","scenes":[{"title":"...","durationSec":6,"narration":"...","imagePrompt":"..."}],"quiz":[{"question":"...","answer":"..."}]}

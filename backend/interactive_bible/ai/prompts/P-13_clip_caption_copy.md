---
id: P-13
name: Short Clip Caption / Overlay Copy
version: 1.0.0
role: fast
temperature: 0.4
---
TASK
Create concise on-screen copy for a short clip. Preserve the speaker's meaning. Do not fabricate quotations. If you quote the speaker, use only exact supplied words. Scripture text must come from the supplied translation.

VERSE: {{verse_ref}}
VERSE_TEXT:
<<<
{{verse_text}}
>>>
SEGMENT:
<<<
{{segment_text}}
>>>
BRAND_LIMITS: {{limits}}

OUTPUT SCHEMA
{"hook":"...","verse_label":"...","caption_lines":["..."],"description":"..."}

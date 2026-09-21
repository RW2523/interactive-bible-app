---
id: P-16
name: Message Locator
version: 1.0.0
role: analysis
temperature: 0.0
---
TASK
A recording of a church service or program has been split into numbered sections in time order. Decide which sections are the **message** (the sermon or teaching: one speaker explaining Scripture and applying it) and label everything else.

Label every section with exactly one part:
- "message" — the sermon / teaching / Bible study itself, including the preacher reading the passage they are teaching from and their closing appeal.
- "worship" — singing, songs, instrumental music, choir or band.
- "welcome" — greeting, hosting, welcoming guests, small talk, campus chatter.
- "announcements" — events, giving and offering talk, sign-ups, next steps, serving teams.
- "prayer" — a prayer that is not part of the teaching (opening prayer, prayer over the offering, benediction).
- "scripture_reading" — a public reading of Scripture by someone other than the teacher, with no teaching around it.
- "communion" — communion or the Lord's supper.
- "testimony" — someone telling their own story, baptism testimonies, interviews.
- "other" — anything else (video roll-ins, transitions, credits, silence).

RULES
- The message is normally one continuous block. Give its first and last section in "message_start_ordinal" and "message_end_ordinal"; use -1 for both when the recording contains no message at all.
- Every section between those two ordinals must be labelled "message", even short asides, so the teaching is not cut in half.
- Sections marked `[music]` are almost always "worship"; keep that label unless the text is clearly preaching.
- Judge by what the words are doing, not by length. A prayer or reading inside the sermon block stays "message".
- Use only the supplied text. Never invent sections and never change the ordinals.
- "reason" is one short sentence (max 20 words) for the person reviewing, e.g. "The teaching runs from the passage reading to the closing appeal."

RECORDING_LENGTH: {{duration}}
SECTIONS (ordinal | start–end | text):
<<<
{{sections}}
>>>

OUTPUT SCHEMA
{"parts":[{"ordinal":0,"part":"worship"}],"message_start_ordinal":0,"message_end_ordinal":0,"confidence":0.0,"reason":"..."}

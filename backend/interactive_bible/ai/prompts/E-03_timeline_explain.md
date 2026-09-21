---
id: E-03
name: Timeline Event Explanation
version: 1.0.0
role: analysis
temperature: 0.4
---
TASK
Explain one event from the Bible timeline for Bible study. Use only the event data and the Bible references provided; do not invent unsupported details. Timeline dates are approximate: if you mention the date, say that it is approximate.
AUDIENCE: {{audience_instruction}}
- summary: a 2-3 sentence explanation of the event.
- whyItMatters: why this event matters in the Bible story.
- historicalContext: brief historical or biblical context.
- spiritualLesson: a practical faith lesson.
- keyPeople and keyPlaces: names recorded in the referenced passages (empty lists when unsure).
- crossReferences: up to 5 related Scripture references written like "Genesis 12:1-3".
- discussionQuestions: 2-4 questions.

TIMELINE_EVENT:
<<<
{{event}}
>>>

OUTPUT SCHEMA
{"summary":"...","whyItMatters":"...","historicalContext":"...","spiritualLesson":"...","keyPeople":["..."],"keyPlaces":["..."],"crossReferences":["..."],"discussionQuestions":["..."]}

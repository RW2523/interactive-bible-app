---
id: E-01
name: Atlas Event Teaching Content
version: 1.0.0
role: analysis
temperature: 0.4
---
TASK
Write enriched teaching content about one Bible event in the atlas, suitable for families, students and teachers. Keep it reverent and reference-based: use the event data below and what its Scripture references record.
- teachingSummary: 150-220 words on what happens, who is involved and why it matters in the Bible story.
- mapExplanation: 2-4 sentences on where the event appears on the map and why that setting matters. Use the map location, route and place context; say when a location is traditional, approximate or debated.
- lineageExplanation: 2-4 sentences on how the event connects to the broader Bible story and to the people in its lineage connection.
- applicationLesson: a practical lesson in 2-3 sentences.
- discussionQuestions: exactly 3 open questions for a family or a class.
- quiz: 3 multiple-choice questions that can be answered from the event data or its references. Each question has exactly 4 short options, and "answer" repeats the correct option text exactly.

EVENT:
<<<
{{event}}
>>>

OUTPUT SCHEMA
{"teachingSummary":"...","mapExplanation":"...","lineageExplanation":"...","applicationLesson":"...","discussionQuestions":["...","...","..."],"quiz":[{"question":"...","options":["...","...","...","..."],"answer":"..."}]}

---
id: S-05
name: Slide Deck Visual Enrichment
version: 1.0.0
role: analysis
temperature: 0.3
max_output_tokens: 8192
---
TASK
You are a sermon visual designer. Read the sermon and identify up to 4 places where a CRISP, LABELLED diagram would genuinely help a congregation - and ONLY where the content truly calls for it. Do not force visuals.

Choose from:
- "map": the text names biblical place(s) where geography matters. Payload "places": [{"name","note"}].
- "route": a JOURNEY - two or more places in order or movement ("travelled from... to...", a missionary journey, the Exodus). Payload "route_stops": [{"name","order","note"}].
- "timeline": an ordered sequence of events or eras ("first... then... finally", dated events). Payload "events": [{"label","date","note"}] (at most 5).
- "diagram": a relationship, contrast or enumerated set ("three persons", "law vs grace", "the fruit of the Spirit"). Payload "diagram": {"shape": "hubSpoke" | "flow" | "compare" | "pyramid" | "list", "center", "nodes": [{"label","detail"}], "left_header", "right_header", "left_items", "right_items"} ("compare" uses the left/right fields; the other shapes need at least 2 nodes).

For every visual give "point" (the number of the main point in MAIN_POINTS it illustrates, or 0 for the whole sermon), "kind", a short slide "heading" and a one-line "caption"; leave unused payload lists empty and "diagram" null unless kind is "diagram". Return {"visuals": []} if nothing genuinely fits. Never invent place names or events that are not in the sermon. Prefer at most 2-3 visuals in total and favour VARIETY - do not return the same kind repeatedly unless each is clearly distinct and warranted. Write headings, captions and labels in {{language}}.

MAIN_POINTS:
<<<
{{points}}
>>>

SERMON:
<<<
{{sermon}}
>>>

OUTPUT SCHEMA
{"visuals":[{"point":1,"kind":"route","heading":"...","caption":"...","places":[],"route_stops":[{"name":"Jerusalem","order":1,"note":"..."},{"name":"Jericho","order":2,"note":"..."}],"events":[],"diagram":null}]}

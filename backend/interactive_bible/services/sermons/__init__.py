"""Sermon Studio: collect -> polish -> visuals -> export & share (owner-only sermons, all files in local storage).

Modules:
* ``catalog``    tones, languages, sermon formats (TEMPLATE_STRUCTURES), export themes, statuses
* ``store``      CRUD, owner-only access, JSON serialisation (slide-plan image keys are signed on read)
* ``structured`` the structured sermon model: normalise, render HTML, sanitise editor HTML, plain text
* ``grounding``  exact local Scripture text for references (inputs, prompt VERSE_TEXTS, draft grounding)
* ``inputs``     typed text / dictation, Scripture selections, audio (Gemini transcription), documents (local extraction)
* ``writing``    polish, format templates, coaching suggestions, speaker notes, draft edits, outreach + public share page
* ``slides``     content-faithful slide deck plan and diagram enrichment merge (pure functions)
* ``visuals``    AI images (single, visual set) and the slide plan with scene images
"""

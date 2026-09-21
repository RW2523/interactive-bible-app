---
id: P-00
name: Timestamped Transcriber
version: 1.0.0
role: transcribe
temperature: 0.0
max_output_tokens: 32768
---
TASK
Transcribe the attached audio verbatim in its original language. Split the transcript into sentence-level utterances. For every utterance give start and end times in SECONDS (decimals allowed) measured from the beginning of THIS audio clip, the speaker label (S1, S2, ... - keep labels consistent within the clip) and the exact words spoken. Do not paraphrase, summarise, correct theology, or add Bible text that was not spoken. Keep spoken Scripture references exactly as said (for example "Romans chapter eight verse twenty-eight" or "Romans 8:28"). If a section is music, silence or unintelligible, emit a short utterance with text "[music]", "[silence]" or "[inaudible]". Times must be non-decreasing and must not exceed the clip duration.

INPUT
CLIP_DURATION_SECONDS: {{clip_duration_seconds}}
LANGUAGE_HINT: {{language}}
SPEAKER_HINT: {{speaker_hint}}

OUTPUT SCHEMA
{"language":"en","utterances":[{"start":0.0,"end":4.2,"speaker":"S1","text":"..."}]}

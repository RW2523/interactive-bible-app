-- How much of a segment the captions marked as music/singing/applause (worship songs inside a service recording).
-- The pipeline maps verses from the preaching and skips AI analysis for mostly-sung segments; the UI can label them.
ALTER TABLE resource_segments ADD COLUMN IF NOT EXISTS non_speech_ratio real NOT NULL DEFAULT 0;

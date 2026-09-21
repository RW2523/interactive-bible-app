-- Which part of a recording a section belongs to (message | worship | welcome | announcements | prayer |
-- scripture_reading | communion | testimony | other). Only "message" sections are mapped to verses and clipped.
ALTER TABLE resource_segments ADD COLUMN IF NOT EXISTS part text;
CREATE INDEX IF NOT EXISTS resource_segments_part ON resource_segments (resource_id, part);

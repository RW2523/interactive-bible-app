-- Interactive Bible App: Sermon Studio (sermon preparation workflow) + Explore (Bible atlas, timeline, story videos)
-- All data is local; generated files live under the storage directory and are served through signed /v1/files URLs.

ALTER TABLE users ADD COLUMN IF NOT EXISTS church text;

-- long-running jobs (story videos, video exports) report progress for the UI
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS progress jsonb;

-- ---------------------------------------------------------------------------------------------- Sermon Studio
CREATE TABLE sermons (
    id               text PRIMARY KEY,
    user_id          text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title            text NOT NULL DEFAULT 'Untitled Sermon',
    status           text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'polished', 'multimedia', 'exported', 'published')),
    current_stage    int NOT NULL DEFAULT 1 CHECK (current_stage BETWEEN 1 AND 4),
    scripture_ref    text,
    theme            text,
    tone             text NOT NULL DEFAULT 'Inspirational',
    language         text NOT NULL DEFAULT 'English',
    export_template  text NOT NULL DEFAULT 'navy_gold',
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sermons_user_updated_idx ON sermons (user_id, updated_at DESC);

CREATE TABLE sermon_inputs (
    id                 text PRIMARY KEY,
    sermon_id          text NOT NULL REFERENCES sermons(id) ON DELETE CASCADE,
    kind               text NOT NULL CHECK (kind IN ('text', 'dictation', 'audio', 'document', 'bible_ref')),
    raw_text           text,
    transcription      text,
    storage_key        text,
    original_filename  text,
    mime_type          text,
    meta               jsonb NOT NULL DEFAULT '{}'::jsonb,  -- bible_ref: {reference, canonical, translation, verse_text}; audio: {duration_seconds}
    created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sermon_inputs_sermon_idx ON sermon_inputs (sermon_id, created_at);

CREATE TABLE sermon_drafts (
    id             text PRIMARY KEY,
    sermon_id      text NOT NULL REFERENCES sermons(id) ON DELETE CASCADE,
    version        int NOT NULL,
    template_type  text NOT NULL DEFAULT 'message'
                   CHECK (template_type IN ('prayer', 'message', 'story', 'devotional', 'teaching', 'testimony', 'youth', 'small_group', 'storytelling', 'custom')),
    structured     jsonb,
    polished_html  text,
    speaker_notes  text,
    slide_plan     jsonb,
    provenance     jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    UNIQUE (sermon_id, version)
);
CREATE INDEX sermon_drafts_sermon_idx ON sermon_drafts (sermon_id, version DESC);

CREATE TABLE sermon_media (
    id           text PRIMARY KEY,
    sermon_id    text NOT NULL REFERENCES sermons(id) ON DELETE CASCADE,
    kind         text NOT NULL CHECK (kind IN ('image', 'map', 'timeline', 'scripture_slide', 'graphic')),
    prompt       text,
    caption      text,
    storage_key  text NOT NULL,
    mime_type    text,
    order_index  int NOT NULL DEFAULT 0,
    provenance   jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sermon_media_sermon_idx ON sermon_media (sermon_id, order_index);

CREATE TABLE sermon_outreach (
    id              text PRIMARY KEY,
    sermon_id       text NOT NULL UNIQUE REFERENCES sermons(id) ON DELETE CASCADE,
    share_slug      text NOT NULL UNIQUE,
    is_public       boolean NOT NULL DEFAULT false,
    summary         text,
    social_caption  text,
    hashtags        text[] NOT NULL DEFAULT '{}',
    social          jsonb NOT NULL DEFAULT '{}'::jsonb,  -- instagram_caption, facebook_post, twitter_thread
    published_at    timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------------------------- Explore
-- AI story videos per Bible event (text plan + scene images + narration). One current story per event and image format.
CREATE TABLE explore_stories (
    event_id      text NOT NULL,
    image_format  text NOT NULL CHECK (image_format IN ('landscape', 'portrait')),
    title         text NOT NULL,
    manifest      jsonb NOT NULL,  -- storage keys only; URLs are signed when served
    scene_count   int NOT NULL,
    has_audio     boolean NOT NULL DEFAULT false,
    mode          text NOT NULL DEFAULT 'gemini',
    generated_by  text REFERENCES users(id) ON DELETE SET NULL,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (event_id, image_format)
);

-- AI illustration shown on an event's map card (generated on request)
CREATE TABLE explore_event_cards (
    event_id     text PRIMARY KEY,
    storage_key  text NOT NULL,
    mime_type    text NOT NULL,
    prompt       text NOT NULL,
    model        text,
    created_by   text REFERENCES users(id) ON DELETE SET NULL,
    created_at   timestamptz NOT NULL DEFAULT now()
);

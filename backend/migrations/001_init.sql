-- Interactive Bible App — baseline schema (spec §8 Data Model)
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- ---------------------------------------------------------------------------
-- Identity, organisations, RBAC
-- ---------------------------------------------------------------------------
CREATE TABLE organizations (
    id          text PRIMARY KEY,
    name        text NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
    id             text PRIMARY KEY,
    email          text NOT NULL UNIQUE,
    display_name   text NOT NULL,
    password_hash  text NOT NULL,
    role           text NOT NULL CHECK (role IN ('member', 'editor', 'admin')),
    is_active      boolean NOT NULL DEFAULT true,
    created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE organization_members (
    organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id         text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (organization_id, user_id)
);

-- ---------------------------------------------------------------------------
-- Bible corpus (canonical ids are translation independent: ROM.8.28 / ordinal 45008028)
-- ---------------------------------------------------------------------------
CREATE TABLE bible_books (
    id          text PRIMARY KEY,           -- USFM code, e.g. ROM
    ordinal     int NOT NULL UNIQUE,
    osis        text NOT NULL,
    name        text NOT NULL,
    testament   text NOT NULL CHECK (testament IN ('OT', 'NT')),
    genre       text NOT NULL,
    attribution text,
    chapters    int NOT NULL
);

CREATE TABLE bible_translations (
    id             text PRIMARY KEY,         -- web, kjv, asv
    name           text NOT NULL,
    abbreviation   text NOT NULL,
    language       text NOT NULL DEFAULT 'en',
    license        text NOT NULL,
    source         text NOT NULL,
    can_display    boolean NOT NULL DEFAULT true,
    can_store      boolean NOT NULL DEFAULT true,
    is_default     boolean NOT NULL DEFAULT false,
    corpus_version text NOT NULL,
    verse_count    int NOT NULL DEFAULT 0,
    loaded_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE bible_verses (
    id             int PRIMARY KEY,          -- BBCCCVVV ordinal
    canonical_ref  text NOT NULL UNIQUE,     -- ROM.8.28
    book_id        text NOT NULL REFERENCES bible_books(id),
    chapter        int NOT NULL,
    verse          int NOT NULL,
    UNIQUE (book_id, chapter, verse)
);

CREATE TABLE bible_verse_texts (
    verse_id        int NOT NULL REFERENCES bible_verses(id) ON DELETE CASCADE,
    translation_id  text NOT NULL REFERENCES bible_translations(id) ON DELETE CASCADE,
    text            text NOT NULL,
    tsv             tsvector GENERATED ALWAYS AS (to_tsvector('english', text)) STORED,
    PRIMARY KEY (verse_id, translation_id)
);
CREATE INDEX bible_verse_texts_tsv ON bible_verse_texts USING gin (tsv);

-- one embedding per canonical verse per embedding model (spec: bible_verses.embedding_id)
CREATE TABLE verse_embeddings (
    verse_id      int NOT NULL REFERENCES bible_verses(id) ON DELETE CASCADE,
    model         text NOT NULL,
    translation_id text NOT NULL,
    content_hash  text NOT NULL,
    embedding     vector(768) NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (verse_id, model)
);
CREATE INDEX verse_embeddings_hnsw ON verse_embeddings USING hnsw (embedding vector_cosine_ops);

-- ---------------------------------------------------------------------------
-- Resources, transcripts, segments
-- ---------------------------------------------------------------------------
CREATE TABLE resources (
    id                 text PRIMARY KEY,
    type               text NOT NULL CHECK (type IN ('video', 'audio', 'pdf', 'document', 'article', 'native', 'generated')),
    category           text NOT NULL DEFAULT 'other',
    title              text NOT NULL,
    description        text,
    source_kind        text NOT NULL CHECK (source_kind IN ('upload', 'url', 'native', 'external_embed')),
    source_uri         text,                 -- storage key (upload) or external URL
    source_hash        text,                 -- sha256 of original bytes / text (immutable once processed)
    original_filename  text,
    mime_type          text,
    size_bytes         bigint,
    captions_uri       text,
    body_text          text,                 -- native / imported content (original, never rewritten)
    owner_id           text REFERENCES users(id) ON DELETE SET NULL,
    organization_id    text REFERENCES organizations(id) ON DELETE SET NULL,
    visibility         text NOT NULL CHECK (visibility IN ('private', 'organization', 'unlisted', 'public')),
    rights_status      text NOT NULL CHECK (rights_status IN ('owned', 'licensed', 'embed_only', 'unknown')),
    allow_clip_export  boolean NOT NULL DEFAULT false,
    is_official        boolean NOT NULL DEFAULT false,
    requires_review    boolean NOT NULL DEFAULT false,
    language           text NOT NULL DEFAULT 'en',
    author             text,
    speaker            text,
    series             text,
    duration_ms        bigint,
    page_count         int,
    media_start_offset_ms bigint NOT NULL DEFAULT 0,
    transcript_mode    text NOT NULL DEFAULT 'auto' CHECK (transcript_mode IN ('auto', 'gemini', 'captions')),
    pii_redaction      boolean NOT NULL DEFAULT true,
    verse_hints        text[] NOT NULL DEFAULT '{}',
    topic_hints        text[] NOT NULL DEFAULT '{}',
    generation_provenance jsonb,
    metadata           jsonb NOT NULL DEFAULT '{}'::jsonb,
    status             text NOT NULL DEFAULT 'draft'
                       CHECK (status IN ('draft', 'ready', 'queued', 'processing', 'processed', 'failed', 'deleted')),
    last_run_id        text,
    processed_at       timestamptz,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now(),
    deleted_at         timestamptz
);
CREATE INDEX resources_visibility ON resources (visibility, status);
CREATE INDEX resources_owner ON resources (owner_id);
CREATE INDEX resources_org ON resources (organization_id);
CREATE INDEX resources_source_hash ON resources (source_hash);

-- immutable extracted / transcribed text (original + normalised units)
CREATE TABLE resource_transcripts (
    id              text PRIMARY KEY,
    resource_id     text NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
    source_hash     text NOT NULL,
    method          text NOT NULL,           -- gemini_transcription | captions | pdf_text | pdf_ocr | docx | markdown | html | native
    method_version  text NOT NULL,
    model           text,
    language        text,
    units           jsonb NOT NULL,          -- [{id,text_raw,text,start_ms,end_ms,speaker,page,kind,heading,char_start,char_end}]
    text_raw        text NOT NULL,
    text_normalized text NOT NULL,
    diagnostics     jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (resource_id, source_hash, method, method_version)
);

CREATE TABLE resource_segments (
    id                   text PRIMARY KEY,   -- content-addressed: stable across reprocessing
    resource_id          text NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
    transcript_id        text REFERENCES resource_transcripts(id) ON DELETE SET NULL,
    ordinal              int NOT NULL,
    start_ms             bigint,
    end_ms               bigint,
    page_start           int,
    page_end             int,
    char_start           int NOT NULL,
    char_end             int NOT NULL,
    unit_ids             text[] NOT NULL DEFAULT '{}',
    heading              text,
    speaker              text,
    transcript_raw       text NOT NULL,
    text_normalized      text NOT NULL,
    unit_offsets         jsonb NOT NULL DEFAULT '[]'::jsonb,  -- [{id,start,end,start_ms,end_ms,page}] offsets inside text_normalized
    topic_hint           text,
    boundary_reason      text,
    summary              text,
    summary_provenance   jsonb,
    clip_start_ms        bigint,
    clip_end_ms          bigint,
    clip_core_start_ms   bigint,
    clip_core_end_ms     bigint,
    clip_reason          text,
    clip_confidence      real,
    clip_provenance      jsonb,
    clip_review_status   text NOT NULL DEFAULT 'none' CHECK (clip_review_status IN ('none', 'auto', 'approved', 'edited')),
    caption_copy         jsonb,
    is_active            boolean NOT NULL DEFAULT true,
    processing_run_id    text,
    tsv                  tsvector GENERATED ALWAYS AS (
                             setweight(to_tsvector('english', coalesce(heading, '')), 'A') ||
                             setweight(to_tsvector('english', coalesce(summary, '')), 'B') ||
                             setweight(to_tsvector('english', text_normalized), 'C')) STORED,
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX resource_segments_resource ON resource_segments (resource_id, ordinal);
CREATE INDEX resource_segments_tsv ON resource_segments USING gin (tsv);

CREATE TABLE segment_embeddings (
    segment_id    text NOT NULL REFERENCES resource_segments(id) ON DELETE CASCADE,
    purpose       text NOT NULL CHECK (purpose IN ('document', 'query')),
    model         text NOT NULL,
    content_hash  text NOT NULL,
    embedding     vector(768) NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (segment_id, purpose, model)
);
CREATE INDEX segment_embeddings_hnsw ON segment_embeddings USING hnsw (embedding vector_cosine_ops);

-- ---------------------------------------------------------------------------
-- Verse <-> resource mappings (spec §8.1 verse_resource_links)
-- ---------------------------------------------------------------------------
CREATE TABLE verse_resource_links (
    id                    text PRIMARY KEY,
    verse_id              int NOT NULL REFERENCES bible_verses(id),
    end_verse_id          int REFERENCES bible_verses(id),         -- set for passage (range) relationships
    segment_id            text NOT NULL REFERENCES resource_segments(id) ON DELETE CASCADE,
    resource_id           text NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
    parent_link_id        text REFERENCES verse_resource_links(id) ON DELETE CASCADE,  -- child verse link of a passage
    relationship_type     text NOT NULL CHECK (relationship_type IN ('direct_reference', 'scripture_quote', 'contextual_reference', 'ai_related')),
    relationship_subtype  text,
    confidence            real NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
    confidence_override   real CHECK (confidence_override IS NULL OR (confidence_override >= 0 AND confidence_override <= 1)),
    primary_flag          boolean NOT NULL DEFAULT false,
    evidence_text         text,
    evidence_offsets      jsonb NOT NULL DEFAULT '[]'::jsonb,       -- [{start,end,start_ms,end_ms}] within segment text_normalized
    mention_count         int NOT NULL DEFAULT 1,
    why_related           text,
    provenance            jsonb NOT NULL,
    review_status         text NOT NULL CHECK (review_status IN ('published', 'pending_review', 'approved', 'rejected', 'index_only', 'discarded')),
    needs_review          boolean NOT NULL DEFAULT false,
    review_reasons        text[] NOT NULL DEFAULT '{}',
    is_human_verified     boolean NOT NULL DEFAULT false,
    audit                 jsonb,
    feedback_count        int NOT NULL DEFAULT 0,
    processing_run_id     text,
    pipeline_version      text,
    created_at            timestamptz NOT NULL DEFAULT now(),
    updated_at            timestamptz NOT NULL DEFAULT now(),
    CHECK (end_verse_id IS NULL OR end_verse_id >= verse_id)
);
CREATE UNIQUE INDEX verse_resource_links_unique ON verse_resource_links (segment_id, verse_id, (coalesce(end_verse_id, verse_id)));
CREATE INDEX verse_resource_links_range ON verse_resource_links USING gist (int4range(verse_id, coalesce(end_verse_id, verse_id), '[]'));
CREATE INDEX verse_resource_links_verse ON verse_resource_links (verse_id);
CREATE INDEX verse_resource_links_resource ON verse_resource_links (resource_id);
CREATE INDEX verse_resource_links_review ON verse_resource_links (review_status, needs_review);

-- ---------------------------------------------------------------------------
-- Verse <-> verse relationships
-- ---------------------------------------------------------------------------
CREATE TABLE verse_relationships (
    id                      bigserial PRIMARY KEY,
    from_verse_id           int NOT NULL REFERENCES bible_verses(id),
    from_end_verse_id       int REFERENCES bible_verses(id),
    to_verse_id             int NOT NULL REFERENCES bible_verses(id),
    to_end_verse_id         int REFERENCES bible_verses(id),
    relationship_type       text NOT NULL CHECK (relationship_type IN ('cross_reference', 'thematic', 'conceptual', 'narrative_parallel', 'question_answer', 'doctrinal_context', 'co_discussed', 'semantic_similarity')),
    source                  text NOT NULL CHECK (source IN ('openbible', 'pipeline', 'embedding', 'human')),
    confidence              real NOT NULL,
    explanation             text,
    explanation_confidence  real,
    explanation_provenance  jsonb,
    evidence                jsonb NOT NULL DEFAULT '{}'::jsonb,
    provenance              jsonb NOT NULL DEFAULT '{}'::jsonb,
    review_status           text NOT NULL DEFAULT 'published' CHECK (review_status IN ('published', 'pending_review', 'approved', 'rejected', 'index_only', 'discarded')),
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX verse_relationships_unique ON verse_relationships (from_verse_id, (coalesce(from_end_verse_id, from_verse_id)), to_verse_id, (coalesce(to_end_verse_id, to_verse_id)), source);
CREATE INDEX verse_relationships_from ON verse_relationships (from_verse_id);
CREATE INDEX verse_relationships_to ON verse_relationships (to_verse_id);

-- ---------------------------------------------------------------------------
-- Topics / entities (controlled vocabularies)
-- ---------------------------------------------------------------------------
CREATE TABLE topics (
    id              text PRIMARY KEY,
    name            text NOT NULL,
    category        text NOT NULL,
    canonical_slug  text NOT NULL UNIQUE,
    description     text,
    aliases         text[] NOT NULL DEFAULT '{}',
    is_controlled   boolean NOT NULL DEFAULT true,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE segment_topics (
    segment_id  text NOT NULL REFERENCES resource_segments(id) ON DELETE CASCADE,
    topic_id    text NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
    confidence  real NOT NULL,
    provenance  jsonb NOT NULL DEFAULT '{}'::jsonb,
    is_human    boolean NOT NULL DEFAULT false,
    PRIMARY KEY (segment_id, topic_id)
);

CREATE TABLE verse_topics (
    verse_id    int NOT NULL REFERENCES bible_verses(id) ON DELETE CASCADE,
    topic_id    text NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
    confidence  real NOT NULL,
    provenance  jsonb NOT NULL DEFAULT '{}'::jsonb,
    PRIMARY KEY (verse_id, topic_id)
);

CREATE TABLE entities (
    id             text PRIMARY KEY,
    type           text NOT NULL CHECK (type IN ('person', 'place', 'event', 'question', 'life_situation')),
    name           text NOT NULL,
    canonical_key  text NOT NULL UNIQUE,
    description    text,
    aliases        text[] NOT NULL DEFAULT '{}',
    passages       text[] NOT NULL DEFAULT '{}',   -- canonical ranges, e.g. LUK.15.11-LUK.15.32
    link_passages  boolean NOT NULL DEFAULT false, -- mentions imply a contextual passage reference
    is_controlled  boolean NOT NULL DEFAULT true,
    created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE segment_entities (
    segment_id  text NOT NULL REFERENCES resource_segments(id) ON DELETE CASCADE,
    entity_id   text NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    confidence  real NOT NULL,
    provenance  jsonb NOT NULL DEFAULT '{}'::jsonb,
    is_human    boolean NOT NULL DEFAULT false,
    PRIMARY KEY (segment_id, entity_id)
);

CREATE TABLE verse_entities (
    verse_id    int NOT NULL REFERENCES bible_verses(id) ON DELETE CASCADE,
    entity_id   text NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    confidence  real NOT NULL,
    provenance  jsonb NOT NULL DEFAULT '{}'::jsonb,
    PRIMARY KEY (verse_id, entity_id)
);

-- ---------------------------------------------------------------------------
-- Processing, provenance, AI call log, caches
-- ---------------------------------------------------------------------------
CREATE TABLE processing_runs (
    id                text PRIMARY KEY,
    resource_id       text NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
    pipeline_version  text NOT NULL,
    model_versions    jsonb NOT NULL DEFAULT '{}'::jsonb,
    prompt_versions   jsonb NOT NULL DEFAULT '{}'::jsonb,
    status            text NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
    current_stage     text,
    stages            jsonb NOT NULL DEFAULT '[]'::jsonb,
    options           jsonb NOT NULL DEFAULT '{}'::jsonb,
    attempts          int NOT NULL DEFAULT 0,
    degraded          boolean NOT NULL DEFAULT false,
    error             text,
    metrics           jsonb NOT NULL DEFAULT '{}'::jsonb,
    triggered_by      text,
    started_at        timestamptz,
    completed_at      timestamptz,
    created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX processing_runs_resource ON processing_runs (resource_id, created_at DESC);

CREATE TABLE llm_calls (
    id               bigserial PRIMARY KEY,
    prompt_id        text NOT NULL,
    prompt_version   text NOT NULL,
    model            text NOT NULL,
    input_hash       text NOT NULL,
    status           text NOT NULL,          -- ok | cached | invalid_json | error | blocked
    cached           boolean NOT NULL DEFAULT false,
    latency_ms       int,
    prompt_tokens    int NOT NULL DEFAULT 0,
    output_tokens    int NOT NULL DEFAULT 0,
    thought_tokens   int NOT NULL DEFAULT 0,
    cost_usd         numeric(12, 6) NOT NULL DEFAULT 0,
    error            text,
    resource_id      text,
    run_id           text,
    created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX llm_calls_created ON llm_calls (created_at);
CREATE INDEX llm_calls_run ON llm_calls (run_id);

CREATE TABLE llm_cache (
    cache_key       text PRIMARY KEY,
    prompt_id       text NOT NULL,
    prompt_version  text NOT NULL,
    model           text NOT NULL,
    output          jsonb NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE jobs (
    id            text PRIMARY KEY,
    queue         text NOT NULL DEFAULT 'default',
    type          text NOT NULL,
    payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
    status        text NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'dead', 'cancelled')),
    priority      int NOT NULL DEFAULT 100,
    attempts      int NOT NULL DEFAULT 0,
    max_attempts  int NOT NULL DEFAULT 3,
    run_after     timestamptz NOT NULL DEFAULT now(),
    locked_by     text,
    locked_at     timestamptz,
    dedupe_key    text,
    result        jsonb,
    last_error    text,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX jobs_pick ON jobs (queue, status, priority, run_after);
CREATE UNIQUE INDEX jobs_dedupe_active ON jobs (dedupe_key) WHERE dedupe_key IS NOT NULL AND status IN ('queued', 'running');

CREATE TABLE worker_heartbeats (
    worker_id    text PRIMARY KEY,
    queues       text[] NOT NULL,
    hostname     text,
    pid          int,
    current_job  text,
    started_at   timestamptz NOT NULL DEFAULT now(),
    seen_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE cache_versions (
    scope    text PRIMARY KEY,            -- 'global' | 'verse:<ordinal>'
    version  bigint NOT NULL DEFAULT 1,
    updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO cache_versions (scope, version) VALUES ('global', 1);

-- ---------------------------------------------------------------------------
-- Review, audit, feedback, analytics
-- ---------------------------------------------------------------------------
CREATE TABLE review_actions (
    id              text PRIMARY KEY,
    object_type     text NOT NULL,         -- mapping | segment | clip | resource | topic | entity | feedback
    object_id       text NOT NULL,
    reviewer_id     text REFERENCES users(id) ON DELETE SET NULL,
    action          text NOT NULL,
    previous_value  jsonb,
    new_value       jsonb,
    note            text,
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX review_actions_object ON review_actions (object_type, object_id, created_at DESC);

CREATE TABLE feedback (
    id           text PRIMARY KEY,
    user_id      text REFERENCES users(id) ON DELETE SET NULL,
    object_type  text NOT NULL CHECK (object_type IN ('mapping', 'segment', 'resource', 'verse_relationship')),
    object_id    text NOT NULL,
    kind         text NOT NULL CHECK (kind IN ('not_relevant', 'wrong_verse', 'wrong_timestamp', 'wrong_quote_reference', 'report_content', 'helpful')),
    note         text,
    status       text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_review', 'resolved', 'dismissed')),
    client_key   text,
    created_at   timestamptz NOT NULL DEFAULT now(),
    resolved_at  timestamptz
);
CREATE INDEX feedback_object ON feedback (object_type, object_id);

CREATE TABLE analytics_events (
    id          bigserial PRIMARY KEY,
    type        text NOT NULL,
    user_id     text,
    payload     jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX analytics_events_type ON analytics_events (type, created_at);

CREATE TABLE search_logs (
    id            bigserial PRIMARY KEY,
    query         text NOT NULL,
    parsed        jsonb,
    result_count  int,
    latency_ms    int,
    user_id       text,
    created_at    timestamptz NOT NULL DEFAULT now()
);

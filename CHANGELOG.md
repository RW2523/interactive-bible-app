# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [1.0.0] — 2026-09-21

First public release.

### Read & Library
- WEB, KJV and ASV reader with verse insights: sermons, podcasts, studies and articles linked to the verses they
  mention, quote, explain or strongly relate to — with evidence, confidence, provenance and human review.
- Semantic search, Ask AI with citations, Scripture Map, clip player, admin review queue and processing monitor.

### YouTube links
- Paste a YouTube URL: details and captions are read with yt-dlp (never downloaded); videos without captions are
  transcribed by Gemini.
- Songs are detected from caption markers, and a new **Find the message** step (P-16) locates the sermon inside a
  service recording, labels worship, welcome, announcements, prayer and testimony, and maps verses from the message only.
- Every verse link gets a short clip that plays in YouTube's own player, bounded to the verse moment.

### Explore
- Offline Bible atlas (50 events, Natural Earth basemap), 583-event timeline, family line, people, knowledge graph.
- AI teaching content, event illustrations and narrated story videos with an HD MP4 export (ffmpeg).

### Sermon Studio
- Notes, dictation, recordings, documents and Scripture become a structured, Scripture-grounded sermon in 10 formats,
  6 tones and 10 languages; visuals, a designed slide deck, PDF/PowerPoint/print/video exports, speaker notes,
  social posts and a public share page.

### Platform
- Personal mode: no sign-in on the computer running the app (owner = admin); other devices sign in.
- Local PostgreSQL + pgvector, job queue with progress and graceful restarts, light/dark themes, phone layout.

[1.0.0]: https://github.com/RW2523/interactive-bible-app/releases/tag/v1.0.0

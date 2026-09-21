"""Application settings (environment-driven, documented in .env.example)."""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

PROJECT_ROOT = Path(__file__).resolve().parents[2]
BACKEND_ROOT = Path(__file__).resolve().parents[1]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(PROJECT_ROOT / ".env"), env_file_encoding="utf-8", extra="ignore"
    )

    # --- core ---
    app_env: str = "local"
    database_url: str = "postgresql+psycopg://interactive_bible@localhost:54329/interactive_bible"
    test_database_url: str = "postgresql+psycopg://interactive_bible@localhost:54329/interactive_bible_test"
    storage_dir: Path = PROJECT_ROOT / "storage"
    cache_dir: Path = PROJECT_ROOT / ".data" / "cache"
    bible_data_dir: Path = PROJECT_ROOT / "data" / "bible"
    explore_data_dir: Path = PROJECT_ROOT / "data" / "explore"  # bible_events.json (atlas), bible_timeline_events.json (timeline)
    frontend_dist: Path = PROJECT_ROOT / "frontend" / "dist"
    secret_key: str = "local-dev-secret-change-me"
    token_ttl_hours: int = 72
    demo_password: str = "bible-demo"
    allow_signup: bool = True
    # Personal (single-user) mode: no sign-in. Requests made on this computer act as the owner account, which has full
    # (admin) access. Other devices on the network still sign in with an account unless single_user_trust_network is on.
    single_user_mode: bool = True
    owner_user_id: str = "usr_admin"
    single_user_trust_network: bool = False
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    # --- Gemini (the only remote AI dependency) ---
    gemini_api_key: str = ""
    gemini_base_url: str = "https://generativelanguage.googleapis.com/v1beta"
    gemini_model_analysis: str = "gemini-flash-latest"
    gemini_model_fast: str = "gemini-flash-lite-latest"
    gemini_model_transcribe: str = "gemini-flash-latest"
    gemini_model_fallbacks: str = "gemini-3-flash-preview,gemini-2.5-flash,gemini-flash-latest"
    gemini_embed_model: str = "gemini-embedding-001"
    embedding_dim: int = 768
    gemini_max_rpm: int = 60
    gemini_concurrency: int = 4
    gemini_timeout_seconds: float = 180.0
    gemini_daily_token_budget: int = 5_000_000
    gemini_thinking_budget: int | None = None  # leave unset unless you know the model supports it
    gemini_thinking_level: str = "low"  # applied to Gemini 3 family models only (low latency extraction)
    gemini_price_input_per_mtok: float = 0.30
    gemini_price_output_per_mtok: float = 2.50
    gemini_price_embed_per_mtok: float = 0.15
    # image + speech generation (Sermon Studio visuals, Explore story videos)
    gemini_image_model: str = "gemini-3.1-flash-image"
    gemini_image_model_hq: str = "gemini-3-pro-image"
    gemini_image_fallbacks: str = "gemini-2.5-flash-image,gemini-3-pro-image-preview"
    gemini_tts_model: str = "gemini-3.1-flash-tts-preview"
    gemini_tts_fallbacks: str = "gemini-2.5-flash-preview-tts"
    gemini_tts_voice: str = "Kore"
    gemini_price_image_output_per_mtok: float = 30.0
    gemini_price_tts_output_per_mtok: float = 10.0
    ai_creative_calls_per_hour: int = 120  # per signed-in user: sermon + explore generation endpoints

    # --- pipeline ---
    pipeline_version: str = "scripture-intelligence-1.0"
    default_translation: str = "web"
    transcribe_chunk_seconds: int = 300
    official_requires_review: bool = True
    feedback_hide_threshold: int = 3
    semantic_candidates: int = 20
    semantic_max_accepted: int = 5
    pii_redaction_default: bool = True

    # --- uploads / abuse ---
    max_upload_mb_media: int = 1024
    max_upload_mb_document: int = 50
    allow_private_url_fetch: bool = False
    rate_limit_per_minute: int = 120
    ask_rate_limit_per_minute: int = 12

    # --- worker ---
    worker_poll_seconds: float = 1.0
    job_lock_timeout_minutes: int = 30
    worker_heartbeat_stale_seconds: int = 120  # running jobs of a worker silent for this long are requeued
    worker_shutdown_grace_seconds: float = 4.0  # on SIGTERM, wait this long for jobs to finish, then hand them back

    embed_bible_on_start: bool = Field(default=True)

    @property
    def ai_enabled(self) -> bool:
        return bool(self.gemini_api_key.strip())

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def model_fallback_list(self) -> list[str]:
        return [m.strip() for m in self.gemini_model_fallbacks.split(",") if m.strip()]

    def image_models(self, high_quality: bool = False) -> list[str]:
        primary = [self.gemini_image_model_hq, self.gemini_image_model] if high_quality else [self.gemini_image_model]
        return _unique(primary + [m.strip() for m in self.gemini_image_fallbacks.split(",")])

    @property
    def tts_models(self) -> list[str]:
        return _unique([self.gemini_tts_model] + [m.strip() for m in self.gemini_tts_fallbacks.split(",")])


def _unique(items: list[str]) -> list[str]:
    out: list[str] = []
    for i in items:
        if i and i not in out:
            out.append(i)
    return out


@lru_cache
def get_settings() -> Settings:
    s = Settings()
    s.storage_dir.mkdir(parents=True, exist_ok=True)
    s.cache_dir.mkdir(parents=True, exist_ok=True)
    return s

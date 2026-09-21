"""Shared fixtures for the Interactive Bible App backend test suite.

* The whole app is pointed at the TEST database (``settings.test_database_url``) before any
  session is opened; the dev database is never touched.
* Uploads/exports go to a throw-away storage directory, never to the project ``storage/``.
* The Bible corpus, cross references, vocabularies and demo users are loaded into the test
  database once (idempotent loaders); they are never truncated.
* Every test starts from empty mutable tables (resources, jobs, runs, AI logs, review, feedback,
  analytics, derived verse data except the curated topic index), empty in-process caches/rate limits and *no* AI.
* Test sessions hold a PostgreSQL advisory lock, so concurrent pytest runs against the same test
  database queue up instead of truncating each other's data.
  Modules that reuse processed resources across tests mark themselves ``shared_data`` and
  build their data in module-scoped fixtures (which call ``reset_mutable_state`` themselves).
* ``fake_llm`` installs a deterministic offline Gemini stand-in (see ``tests/fakes.py``).
"""
from __future__ import annotations

import logging
import shutil
import tempfile
from pathlib import Path
from typing import Iterator

import pytest

from interactive_bible.config import get_settings

settings = get_settings()
if settings.test_database_url == settings.database_url:
    raise RuntimeError("TEST_DATABASE_URL must differ from DATABASE_URL: the test suite truncates tables")

# --- isolate everything BEFORE app modules open sessions ------------------------------------
TEST_ROOT = Path(tempfile.mkdtemp(prefix="interactive_bible-tests-"))
settings.database_url = settings.test_database_url  # no code path may fall back to the dev database
settings.storage_dir = TEST_ROOT / "storage"
settings.cache_dir = TEST_ROOT / "cache"
settings.storage_dir.mkdir(parents=True, exist_ok=True)
settings.cache_dir.mkdir(parents=True, exist_ok=True)
settings.gemini_api_key = ""  # all AI in tests is faked
settings.embed_bible_on_start = False
settings.single_user_mode = False  # tests exercise accounts; personal mode has its own tests (test_single_user_mode.py)
settings.demo_password = "test-demo-password"  # demo accounts' password in the test database (never the one in .env)
settings.public_base_url = ""

import httpx  # noqa: E402

_real_handle_request = httpx.HTTPTransport.handle_request


def _no_google_network(self, request: httpx.Request) -> httpx.Response:
    # .env may hold a real GEMINI_API_KEY: a test that builds its own Settings() must never reach the live API
    if request.url.host.endswith("googleapis.com"):
        raise RuntimeError(f"tests must not call the live Google API ({request.url.host}); use tests/fakes.py or httpx.MockTransport")
    return _real_handle_request(self, request)


httpx.HTTPTransport.handle_request = _no_google_network

from interactive_bible.db import set_database_url_override  # noqa: E402

set_database_url_override(settings.test_database_url)

from interactive_bible import cache  # noqa: E402
from interactive_bible.ai.llm import set_llm_client  # noqa: E402
from interactive_bible.db import session_scope  # noqa: E402

from .fakes import FakeGeminiClient, UnconfiguredClient  # noqa: E402
from .support import auth_headers, clear_process_state, make_silent_audio, reset_mutable_state  # noqa: E402


def pytest_configure(config: pytest.Config) -> None:
    config.addinivalue_line("markers", "shared_data: module reuses processed resources built by module-scoped fixtures (no per-test truncation)")
    config.addinivalue_line("markers", "nodb: pure unit tests that need no database")


def pytest_sessionfinish(session: pytest.Session, exitstatus: int) -> None:
    shutil.rmtree(TEST_ROOT, ignore_errors=True)  # also covers runs that never started the database fixture


def pytest_collection_modifyitems(config: pytest.Config, items: list[pytest.Item]) -> None:
    for item in items:
        if item.path.name == "test_refparser.py":  # the original parser suite is pure
            item.add_marker(pytest.mark.nodb)


def install_no_llm() -> UnconfiguredClient:
    client = UnconfiguredClient()
    set_llm_client(client)
    return client


SESSION_LOCK_KEY = 4242999  # one pytest session at a time per test database (tests truncate shared tables)


def _acquire_session_lock(timeout_s: float = 600.0):
    import time

    from sqlalchemy import text

    from interactive_bible.db import get_engine

    conn = get_engine(settings.test_database_url).connect()
    deadline = time.monotonic() + timeout_s
    while not conn.execute(text("SELECT pg_try_advisory_lock(:k)"), {"k": SESSION_LOCK_KEY}).scalar():
        conn.rollback()
        if time.monotonic() > deadline:
            conn.close()
            raise RuntimeError("another pytest session is using the test database (advisory lock busy)")
        time.sleep(0.5)
    conn.commit()  # keep the session-level lock, end the implicit transaction
    return conn


@pytest.fixture(scope="session")
def test_database() -> Iterator[str]:
    """Migrate + load corpus/cross references/vocabulary/demo users into the test DB (idempotent, once)."""
    from interactive_bible.bible import loader
    from interactive_bible.cli import ensure_users
    from interactive_bible.migrate import migrate
    from interactive_bible.vocab.service import seed_vocabulary

    install_no_llm()
    lock = _acquire_session_lock()  # released after the final cleanup below
    migrate(settings.test_database_url)
    with session_scope() as s:
        loader.load_books_and_verses(s)
    with session_scope() as s:
        loader.load_translations(s)
    with session_scope() as s:
        loader.load_cross_references(s)
    with session_scope() as s:
        seed_vocabulary(s)
    ensure_users()
    with session_scope() as s:
        cache.ensure_scopes(s)
    reset_mutable_state()
    try:
        yield settings.test_database_url
    finally:
        reset_mutable_state()
        shutil.rmtree(TEST_ROOT, ignore_errors=True)
        from sqlalchemy import text

        lock.execute(text("SELECT pg_advisory_unlock(:k)"), {"k": SESSION_LOCK_KEY})
        lock.commit()
        lock.close()


@pytest.fixture(scope="session")
def quote_index(test_database):
    from interactive_bible.retrieval.quotes import get_quote_index

    with session_scope() as s:
        return get_quote_index(s)


@pytest.fixture(autouse=True)
def _isolation(request: pytest.FixtureRequest) -> Iterator[None]:
    install_no_llm()
    if not request.node.get_closest_marker("nodb"):
        request.getfixturevalue("test_database")
        if request.node.get_closest_marker("shared_data"):
            clear_process_state()
        else:
            reset_mutable_state()
    yield
    install_no_llm()
    clear_process_state()


# ----------------------------------------------------------------------------- fixtures
@pytest.fixture
def db(test_database):
    with session_scope() as s:
        yield s


@pytest.fixture(scope="session")
def _app_client(test_database):
    from fastapi.testclient import TestClient

    from interactive_bible.api.main import app

    install_no_llm()  # the lifespan only enqueues the Bible embedding job when AI is configured
    with TestClient(app) as c:
        logging.getLogger().setLevel(logging.WARNING)
        yield c


@pytest.fixture
def client(_app_client):
    _app_client.cookies.clear()  # /auth/login sets a session cookie: never leak it between tests
    yield _app_client
    _app_client.cookies.clear()


@pytest.fixture
def login(test_database):
    """login(email) -> Authorization headers for a demo user (token issued directly; test_reading_search covers /auth/login)."""
    return auth_headers


@pytest.fixture
def fake_llm() -> Iterator[FakeGeminiClient]:
    fake = FakeGeminiClient()
    set_llm_client(fake)
    yield fake
    install_no_llm()


@pytest.fixture
def no_llm() -> Iterator[UnconfiguredClient]:
    yield install_no_llm()


@pytest.fixture(scope="session")
def project_root() -> Path:
    from interactive_bible.config import PROJECT_ROOT

    return PROJECT_ROOT


@pytest.fixture(scope="session")
def media_dir(test_database) -> Path:
    path = TEST_ROOT / "media"
    path.mkdir(parents=True, exist_ok=True)
    return path


@pytest.fixture(scope="session")
def silent_mp3(media_dir) -> Path:
    if not shutil.which("ffmpeg"):
        pytest.skip("ffmpeg is required for media tests")
    return make_silent_audio(media_dir / "silence_20s.mp3", 20)

from __future__ import annotations

import os
import tempfile
from collections.abc import Iterator

import pytest

os.environ.setdefault("CCARF_DATABASE_URL", "sqlite:///" + tempfile.mktemp(suffix=".db"))
os.environ.setdefault("CCARF_SECRET_KEY", "test-secret-key-not-for-production-use")
os.environ.setdefault("CCARF_RATE_LIMIT_ENABLED", "false")
os.environ.setdefault("CCARF_BCRYPT_ROUNDS", "4")  # keep the suite fast

from fastapi.testclient import TestClient  # noqa: E402

from app.core import ratelimit  # noqa: E402
from app.db.session import Base, engine  # noqa: E402
from app.main import app  # noqa: E402

PASSWORD = "Str0ng-Passw0rd!"


@pytest.fixture(autouse=True)
def _clean_database() -> Iterator[None]:
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    ratelimit.reset()
    yield


@pytest.fixture
def client() -> Iterator[TestClient]:
    with TestClient(app) as c:
        yield c


def register(client: TestClient, email: str = "learner@example.com") -> dict:
    response = client.post(
        "/api/v1/auth/register",
        json={"email": email, "full_name": "Test Learner", "password": PASSWORD},
    )
    assert response.status_code == 201, response.text
    return response.json()


@pytest.fixture
def auth(client: TestClient) -> dict:
    """First registered account — becomes the administrator."""
    tokens = register(client)
    return {"Authorization": f"Bearer {tokens['access_token']}"}


@pytest.fixture
def content_sandbox(tmp_path, monkeypatch):
    """Isolate admin content-mutation endpoints from the real, shipped content bank.

    The admin PUT/DELETE/import/mark-reviewed endpoints write straight to
    files under ``app/content/`` (questions, and ``blueprint.json`` for the
    freshness tracker). Testing them against the real directory would
    permanently corrupt or delete authored exam content the moment a test
    runs — this copies the whole content tree into a temp directory and
    repoints ``content.QUESTIONS_DIR``, ``content.CHEATSHEETS_DIR`` and
    ``admin.CONTENT_DIR`` at the copy for the duration of the test, exactly
    the way the DB fixture isolates SQL state.
    """
    import shutil

    from app.api.routers import admin as admin_router
    from app.core.config import CONTENT_DIR as REAL_CONTENT_DIR
    from app.services import content

    sandbox_content = tmp_path / "content"
    shutil.copytree(REAL_CONTENT_DIR, sandbox_content)

    monkeypatch.setattr(content, "CONTENT_DIR", sandbox_content)
    monkeypatch.setattr(content, "QUESTIONS_DIR", sandbox_content / "questions")
    monkeypatch.setattr(content, "CHEATSHEETS_DIR", sandbox_content / "cheatsheets")
    monkeypatch.setattr(admin_router, "CONTENT_DIR", sandbox_content)
    content.clear_content_caches()
    content.get_blueprint.cache_clear()
    yield sandbox_content
    content.clear_content_caches()
    content.get_blueprint.cache_clear()  # restore cached views of the real bank

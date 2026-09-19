from __future__ import annotations

import os
import uuid
from collections.abc import Iterator

import httpx
import pytest

os.environ.setdefault("CCARF_RATE_LIMIT_ENABLED", "false")

from fastapi.testclient import TestClient  # noqa: E402

from app.api import deps as deps_module  # noqa: E402
from app.core import ratelimit  # noqa: E402
from app.core.config import settings  # noqa: E402
from app.core.supabase_auth import TokenError  # noqa: E402
from app.db.session import SessionLocal  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Profile, UserRole  # noqa: E402


def _fake_verify_supabase_jwt(token: str) -> dict:
    """Test-only stand-in for the real JWKS check in core/supabase_auth.py.

    Every fixture user's bearer token is just ``test:<uuid>`` --
    api.deps.get_current_user only needs a claims dict with a valid ``sub``,
    so most of the suite never has to do a real password-grant sign-in
    against Supabase just to exercise business logic that has nothing to do
    with auth itself.
    """
    if not token.startswith("test:"):
        raise TokenError("not a fixture token")
    return {"sub": token.removeprefix("test:"), "exp": 9999999999}


@pytest.fixture(autouse=True)
def _mock_jwt_verification(monkeypatch):
    monkeypatch.setattr(deps_module, "verify_supabase_jwt", _fake_verify_supabase_jwt)


@pytest.fixture(autouse=True)
def _reset_rate_limiter() -> None:
    ratelimit.reset()


def _admin_api_headers() -> dict:
    if not settings.supabase_url or not settings.supabase_service_role_key:
        pytest.fail(
            "CCARF_SUPABASE_URL and CCARF_SUPABASE_SERVICE_ROLE_KEY must both be "
            "set to run this suite -- fixtures create real (throwaway) Supabase "
            "Auth users via the Admin API, since public.profiles/attempts are "
            "FK-constrained to auth.users. See backend/.env.example."
        )
    return {
        "apikey": settings.supabase_service_role_key,
        "Authorization": f"Bearer {settings.supabase_service_role_key}",
    }


_created_user_ids: set[str] = set()


def _create_auth_user(email: str) -> str:
    """Create a real, throwaway Supabase Auth user via the Admin API.

    A fixture can't just insert a ``profiles`` row with a random uuid --
    both ``profiles.id`` and ``attempts.user_id`` reference ``auth.users(id)``.
    Creating the auth user for real (and letting the ``handle_new_user``
    trigger populate ``profiles``, exactly like a real sign-up) is what keeps
    that constraint satisfied. Deleted again per-test in
    ``_cleanup_test_users`` below.
    """
    response = httpx.post(
        f"{settings.supabase_url}/auth/v1/admin/users",
        headers=_admin_api_headers(),
        json={"email": email, "email_confirm": True, "password": uuid.uuid4().hex},
        timeout=10,
    )
    response.raise_for_status()
    user_id = response.json()["id"]
    _created_user_ids.add(user_id)
    return user_id


def _delete_auth_user(user_id: str) -> None:
    httpx.delete(
        f"{settings.supabase_url}/auth/v1/admin/users/{user_id}",
        headers=_admin_api_headers(),
        timeout=10,
    )


@pytest.fixture(autouse=True)
def _cleanup_test_users() -> Iterator[None]:
    yield
    for user_id in list(_created_user_ids):
        _delete_auth_user(user_id)
        _created_user_ids.discard(user_id)


@pytest.fixture
def client() -> Iterator[TestClient]:
    with TestClient(app) as c:
        yield c


def register(client: TestClient, email: str = "learner@example.com", role: str = UserRole.USER) -> dict:
    """Create a throwaway Supabase-backed user and a fixture bearer token for it.

    ``client`` is kept as a parameter for call-site compatibility with the
    rest of the suite (there is no local ``/auth/register`` endpoint to hit
    any more -- Supabase Auth owns sign-up).
    """
    user_id = _create_auth_user(email)
    db = SessionLocal()
    try:
        profile = db.get(Profile, uuid.UUID(user_id))
        assert profile is not None, "handle_new_user trigger did not create a profile row"
        profile.full_name = "Test Learner"
        profile.role = role
        db.commit()
    finally:
        db.close()
    return {"access_token": f"test:{user_id}", "id": user_id, "email": email}


@pytest.fixture
def auth(client: TestClient) -> dict:
    """An admin-role account -- most of the suite was written expecting the
    fixture user to have admin rights (see e.g. test_admin_content.py using
    ``auth`` directly against admin-only endpoints)."""
    tokens = register(client, role=UserRole.ADMIN)
    return {"Authorization": f"Bearer {tokens['access_token']}"}


@pytest.fixture
def content_sandbox(tmp_path, monkeypatch):
    """Isolate admin content-mutation endpoints from the real, shipped content bank.

    The admin PUT/DELETE/import/mark-reviewed endpoints write straight to
    files under ``app/content/`` (questions, and ``blueprint.json`` for the
    freshness tracker). Testing them against the real directory would
    permanently corrupt or delete authored exam content the moment a test
    runs -- this copies the whole content tree into a temp directory and
    repoints ``content.QUESTIONS_DIR``, ``content.CHEATSHEETS_DIR`` and
    ``admin.CONTENT_DIR`` at the copy for the duration of the test, exactly
    the way the fixture-user teardown isolates auth/DB state.
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

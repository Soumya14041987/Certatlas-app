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

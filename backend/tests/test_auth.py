from app.core.security import hash_password, verify_password
from tests.conftest import PASSWORD, register


def test_password_hash_roundtrip_and_rejection():
    hashed = hash_password(PASSWORD)
    assert hashed != PASSWORD
    assert verify_password(PASSWORD, hashed)
    assert not verify_password("wrong", hashed)


def test_long_passwords_are_not_truncated_at_72_bytes():
    # bcrypt truncates at 72 bytes; the SHA-256 pre-hash must prevent that.
    base = "A" * 72
    assert not verify_password(base + "different", hash_password(base + "original"))


def test_weak_password_is_rejected(client):
    response = client.post(
        "/api/v1/auth/register",
        json={"email": "weak@example.com", "full_name": "Weak", "password": "password"},
    )
    assert response.status_code == 422


def test_duplicate_email_is_rejected(client):
    register(client)
    response = client.post(
        "/api/v1/auth/register",
        json={"email": "learner@example.com", "full_name": "Again", "password": PASSWORD},
    )
    assert response.status_code == 409


def test_first_user_is_admin_and_second_is_not(client):
    register(client, "first@example.com")
    second = register(client, "second@example.com")
    headers = {"Authorization": f"Bearer {second['access_token']}"}
    assert client.get("/api/v1/auth/me", headers=headers).json()["role"] == "user"
    assert client.get("/api/v1/admin/stats", headers=headers).status_code == 403


def test_login_and_refresh_rotation(client):
    register(client)
    login = client.post(
        "/api/v1/auth/login", json={"email": "learner@example.com", "password": PASSWORD}
    )
    assert login.status_code == 200
    refresh_token = login.json()["refresh_token"]

    first = client.post("/api/v1/auth/refresh", json={"refresh_token": refresh_token})
    assert first.status_code == 200
    # The presented refresh token is retired on use.
    replay = client.post("/api/v1/auth/refresh", json={"refresh_token": refresh_token})
    assert replay.status_code == 401


def test_bad_credentials_are_rejected(client):
    register(client)
    response = client.post(
        "/api/v1/auth/login", json={"email": "learner@example.com", "password": "Wr0ng-Pass!"}
    )
    assert response.status_code == 401


def test_protected_route_requires_a_token(client):
    assert client.get("/api/v1/auth/me").status_code == 401
    assert client.get("/api/v1/analytics/overview").status_code == 401
    bad = {"Authorization": "Bearer not-a-real-token"}
    assert client.get("/api/v1/auth/me", headers=bad).status_code == 401


def test_logout_revokes_the_session(client):
    tokens = register(client)
    client.post("/api/v1/auth/logout", json={"refresh_token": tokens["refresh_token"]})
    response = client.post("/api/v1/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
    assert response.status_code == 401

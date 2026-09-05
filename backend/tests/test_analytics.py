from tests.test_attempts import _answer_all


def test_overview_starts_empty(client, auth):
    body = client.get("/api/v1/analytics/overview", headers=auth).json()
    assert body["attempts_submitted"] == 0
    assert body["readiness"] == "not_started"
    assert body["projected_score"] is None


def test_overview_reflects_a_perfect_attempt(client, auth):
    attempt = client.post("/api/v1/practice/start", headers=auth, json={"set_number": 20}).json()
    _answer_all(client, auth, attempt, correct=True)
    client.post(f"/api/v1/attempts/{attempt['id']}/submit", headers=auth)

    body = client.get("/api/v1/analytics/overview", headers=auth).json()
    assert body["attempts_submitted"] == 1
    assert body["best_score"] == 100.0
    assert body["projected_score"] == 100.0
    assert body["readiness"] == "ready"
    assert len(body["trend"]) == 1
    assert all(d["percent"] == 100.0 for d in body["domains"])


def test_blueprint_and_courses_are_public(client):
    blueprint = client.get("/api/v1/blueprint")
    assert blueprint.status_code == 200
    assert blueprint.json()["practice_sets"] == 300
    assert blueprint.json()["bank"]["total_questions"] > 150

    courses = client.get("/api/v1/courses")
    assert courses.status_code == 200
    assert len(courses.json()["courses"]) >= 8


def test_admin_stats_require_the_admin_role(client, auth):
    from tests.conftest import register

    assert client.get("/api/v1/admin/stats", headers=auth).status_code == 200
    other = register(client, "plain@example.com")
    plain = {"Authorization": f"Bearer {other['access_token']}"}
    assert client.get("/api/v1/admin/stats", headers=plain).status_code == 403
    assert client.get("/api/v1/admin/users", headers=plain).status_code == 403


def test_admin_cannot_demote_themselves(client, auth):
    me = client.get("/api/v1/auth/me", headers=auth).json()
    response = client.patch(
        f"/api/v1/admin/users/{me['id']}", headers=auth, json={"role": "user"}
    )
    assert response.status_code == 400


def test_health_and_root(client):
    assert client.get("/health").json()["status"] == "ok"
    assert "disclaimer" in client.get("/").json()

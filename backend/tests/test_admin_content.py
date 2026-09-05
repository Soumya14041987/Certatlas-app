"""Admin question-management endpoints: browse, template, edit, delete.

Mutating tests use the ``content_sandbox`` fixture so they never touch the
real, shipped question bank — see its docstring in conftest.py.
"""
from tests.conftest import register

TEMPLATE_BASED_QUESTION = {
    "id": "TEST-ADMIN-001",
    "domain": "AAO",
    "difficulty": "applied",
    "type": "single",
    "objective": "admin-authored test item",
    "stem": "This question exists only to exercise the admin content endpoints.",
    "options": [
        {"key": "A", "text": "Correct by construction"},
        {"key": "B", "text": "Wrong option one"},
        {"key": "C", "text": "Wrong option two"},
        {"key": "D", "text": "Wrong option three"},
    ],
    "correct": ["A"],
    "explanation": "It is correct because the test says so.",
    "distractor_notes": {"B": "Wrong.", "C": "Wrong.", "D": "Wrong."},
    "cheatsheet": "d3-agentic#subagents",
    "sources": [],
    "tags": ["test-fixture"],
}


def _plain_user_headers(client) -> dict:
    other = register(client, "not-admin@example.com")
    return {"Authorization": f"Bearer {other['access_token']}"}


def test_content_endpoints_require_admin_role(client, auth):
    plain = _plain_user_headers(client)
    assert client.get("/api/v1/admin/content/questions", headers=plain).status_code == 403
    assert client.get("/api/v1/admin/content/questions/template", headers=plain).status_code == 403
    assert client.get("/api/v1/admin/content/questions/D3-001", headers=plain).status_code == 403
    assert (
        client.put("/api/v1/admin/content/questions/D3-001", headers=plain, json={}).status_code
        == 403
    )
    assert (
        client.delete("/api/v1/admin/content/questions/D3-001", headers=plain).status_code == 403
    )


def test_template_is_a_valid_startable_question(client, auth):
    response = client.get("/api/v1/admin/content/questions/template", headers=auth)
    assert response.status_code == 200
    template = response.json()["template"]
    assert template["domain"] in {"AAO", "TDM", "CCW", "PES", "CMR"}
    assert template["correct"] == ["A"]
    assert set(template["distractor_notes"]) == {"B", "C", "D"}


def test_browse_supports_domain_filter_search_and_pagination(client, auth):
    all_items = client.get("/api/v1/admin/content/questions", headers=auth).json()
    assert all_items["total"] > 200

    aao_only = client.get("/api/v1/admin/content/questions?domain=aao", headers=auth).json()
    assert aao_only["total"] > 0
    assert all(item["domain"] == "AAO" for item in aao_only["items"])

    searched = client.get(
        "/api/v1/admin/content/questions?search=subagent", headers=auth
    ).json()
    assert searched["total"] > 0

    first_page = client.get(
        "/api/v1/admin/content/questions?per_page=5&page=1", headers=auth
    ).json()
    assert len(first_page["items"]) == 5
    assert first_page["items"][0]["explanation"]  # full reveal(), not the public() view


def test_get_single_question_includes_source_file(client, auth):
    response = client.get("/api/v1/admin/content/questions/D3-001", headers=auth)
    assert response.status_code == 200
    body = response.json()
    assert body["id"] == "D3-001"
    assert body["source_file"] and body["source_file"].endswith(".json")


def test_get_unknown_question_is_404(client, auth):
    assert client.get("/api/v1/admin/content/questions/NOPE-001", headers=auth).status_code == 404


def test_import_edit_and_delete_round_trip(client, auth, content_sandbox):
    # Import a brand-new question.
    imported = client.post(
        "/api/v1/admin/content/questions",
        headers=auth,
        json={"name": "test-batch", "questions": [TEMPLATE_BASED_QUESTION]},
    )
    assert imported.status_code == 201
    assert imported.json()["imported"] == 1

    fetched = client.get("/api/v1/admin/content/questions/TEST-ADMIN-001", headers=auth)
    assert fetched.status_code == 200
    assert fetched.json()["explanation"] == "It is correct because the test says so."

    # Edit it — this is the "continuous improvement" path.
    corrected = {**TEMPLATE_BASED_QUESTION, "explanation": "Corrected after review."}
    edited = client.put(
        "/api/v1/admin/content/questions/TEST-ADMIN-001", headers=auth, json=corrected
    )
    assert edited.status_code == 200
    refetched = client.get("/api/v1/admin/content/questions/TEST-ADMIN-001", headers=auth)
    assert refetched.json()["explanation"] == "Corrected after review."

    # Delete it.
    deleted = client.delete("/api/v1/admin/content/questions/TEST-ADMIN-001", headers=auth)
    assert deleted.status_code == 204
    assert (
        client.get("/api/v1/admin/content/questions/TEST-ADMIN-001", headers=auth).status_code
        == 404
    )


def test_edit_rejects_id_mismatch(client, auth, content_sandbox):
    client.post(
        "/api/v1/admin/content/questions",
        headers=auth,
        json={"name": "test-batch-2", "questions": [TEMPLATE_BASED_QUESTION]},
    )
    mismatched = {**TEMPLATE_BASED_QUESTION, "id": "SOMETHING-ELSE"}
    response = client.put(
        "/api/v1/admin/content/questions/TEST-ADMIN-001", headers=auth, json=mismatched
    )
    assert response.status_code == 400


def test_edit_rejects_invalid_content(client, auth, content_sandbox):
    client.post(
        "/api/v1/admin/content/questions",
        headers=auth,
        json={"name": "test-batch-3", "questions": [TEMPLATE_BASED_QUESTION]},
    )
    broken = {**TEMPLATE_BASED_QUESTION, "correct": ["Z"]}  # not a real option key
    response = client.put(
        "/api/v1/admin/content/questions/TEST-ADMIN-001", headers=auth, json=broken
    )
    assert response.status_code == 422


def test_delete_unknown_question_is_404(client, auth, content_sandbox):
    response = client.delete("/api/v1/admin/content/questions/NOPE-001", headers=auth)
    assert response.status_code == 404


def test_editing_and_deleting_does_not_touch_the_real_bank(client, auth, content_sandbox):
    """The whole point of content_sandbox: real files are never written to."""
    from app.services.content import QUESTIONS_DIR  # patched to the sandbox by the fixture

    assert "tmp" in str(QUESTIONS_DIR).lower() or "pytest" in str(QUESTIONS_DIR).lower()
    client.delete("/api/v1/admin/content/questions/D3-001", headers=auth)
    # If this ran against the real bank, D3-001 would now be permanently gone.
    # Re-reading it here proves the sandbox, not the shipped file, was mutated.
    assert (
        client.get("/api/v1/admin/content/questions/D3-001", headers=auth).status_code == 404
    )


def test_mark_reviewed_requires_admin(client, auth, content_sandbox):
    plain = _plain_user_headers(client)
    response = client.post(
        "/api/v1/admin/content/mark-reviewed", headers=plain, json={"verified_by": "someone"}
    )
    assert response.status_code == 403


def test_mark_reviewed_updates_freshness_and_is_reflected_publicly(client, auth, content_sandbox):
    before = client.get("/api/v1/blueprint").json()["freshness"]["last_verified"]

    response = client.post(
        "/api/v1/admin/content/mark-reviewed",
        headers=auth,
        json={"verified_by": "Soumyadip", "version": "2026.2"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["verified_by"] == "Soumyadip"
    assert body["version"] == "2026.2"
    assert body["last_verified"] >= before

    refreshed = client.get("/api/v1/blueprint").json()
    assert refreshed["version"] == "2026.2"
    assert refreshed["freshness"]["verified_by"] == "Soumyadip"


def test_mark_reviewed_does_not_touch_the_real_blueprint(client, auth, content_sandbox):
    import json as jsonlib
    from pathlib import Path

    real_path = Path(__file__).resolve().parents[1] / "app" / "content" / "blueprint.json"
    real_before = jsonlib.loads(real_path.read_text())

    client.post(
        "/api/v1/admin/content/mark-reviewed",
        headers=auth,
        json={"verified_by": "sandbox-only", "version": "9999.9"},
    )

    real_after = jsonlib.loads(real_path.read_text())
    assert real_after == real_before

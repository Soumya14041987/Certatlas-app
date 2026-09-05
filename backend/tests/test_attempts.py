from app.services.content import get_question


def _answer_all(client, headers, attempt, correct: bool):
    """Answer every question; when correct=False, pick a deliberately wrong option."""
    for q in attempt["questions"]:
        question = get_question(q["id"])
        if correct:
            selected = question.correct
        else:
            wrong = [o["key"] for o in question.options if o["key"] not in question.correct]
            selected = wrong[: question.select_count]
        client.post(
            f"/api/v1/attempts/{attempt['id']}/answer",
            headers=headers,
            json={"question_id": q["id"], "selected": selected, "seconds_spent": 5},
        )


def test_practice_set_catalogue_requires_auth(client):
    assert client.get("/api/v1/practice/sets").status_code == 401


def test_start_practice_returns_a_sixty_question_paper(client, auth):
    response = client.post("/api/v1/practice/start", headers=auth, json={"set_number": 3})
    assert response.status_code == 201
    body = response.json()
    assert body["mode"] == "practice"
    assert body["total_questions"] == 60
    assert len(body["questions"]) == 60
    assert body["can_pause"] is True
    assert body["remaining_seconds"] is None


def test_live_paper_never_leaks_the_answer_key(client, auth):
    body = client.post("/api/v1/practice/start", headers=auth, json={"set_number": 4}).json()
    for question in body["questions"]:
        assert "correct" not in question
        assert "explanation" not in question
        assert "distractor_notes" not in question


def test_pause_stops_the_clock_and_resume_restores_the_same_paper(client, auth):
    attempt = client.post("/api/v1/practice/start", headers=auth, json={"set_number": 5}).json()
    client.post(
        f"/api/v1/attempts/{attempt['id']}/answer",
        headers=auth,
        json={"question_id": attempt["questions"][0]["id"], "selected": ["A"], "seconds_spent": 12},
    )

    paused = client.post(f"/api/v1/attempts/{attempt['id']}/pause", headers=auth)
    assert paused.status_code == 200
    assert paused.json()["status"] == "paused"

    # A paused attempt refuses further answers.
    blocked = client.post(
        f"/api/v1/attempts/{attempt['id']}/answer",
        headers=auth,
        json={"question_id": attempt["questions"][1]["id"], "selected": ["A"]},
    )
    assert blocked.status_code == 409

    resumed = client.post(f"/api/v1/attempts/{attempt['id']}/resume", headers=auth).json()
    assert resumed["status"] == "in_progress"
    assert [q["id"] for q in resumed["questions"]] == [q["id"] for q in attempt["questions"]]
    assert resumed["answers"][attempt["questions"][0]["id"]]["selected"] == ["A"]


def test_starting_the_same_set_resumes_the_open_attempt(client, auth):
    first = client.post("/api/v1/practice/start", headers=auth, json={"set_number": 6}).json()
    client.post(f"/api/v1/attempts/{first['id']}/pause", headers=auth)
    second = client.post("/api/v1/practice/start", headers=auth, json={"set_number": 6}).json()
    assert second["id"] == first["id"]
    assert second["status"] == "in_progress"


def test_full_score_and_scorecard(client, auth):
    attempt = client.post("/api/v1/practice/start", headers=auth, json={"set_number": 7}).json()
    _answer_all(client, auth, attempt, correct=True)

    card = client.post(f"/api/v1/attempts/{attempt['id']}/submit", headers=auth)
    assert card.status_code == 200
    body = card.json()
    assert body["score_percent"] == 100.0
    assert body["correct"] == 60
    assert body["passed"] is True
    assert sum(d["total"] for d in body["domain_breakdown"].values()) == 60


def test_zero_score_review_inlines_teaching_material(client, auth):
    attempt = client.post("/api/v1/practice/start", headers=auth, json={"set_number": 8}).json()
    _answer_all(client, auth, attempt, correct=False)
    card = client.post(f"/api/v1/attempts/{attempt['id']}/submit", headers=auth).json()
    assert card["score_percent"] == 0.0
    assert card["passed"] is False

    review = client.get(
        f"/api/v1/attempts/{attempt['id']}/review?only_incorrect=true", headers=auth
    ).json()
    assert review["count"] == 60
    for item in review["items"]:
        assert item["is_correct"] is False
        assert item["explanation"]
        assert item["correct"]
        # Wrong answers must arrive with the cheat-sheet section attached.
        assert item["cheatsheet_content"] is not None
        assert item["cheatsheet_content"]["title"]


def test_unanswered_questions_count_as_incorrect(client, auth):
    attempt = client.post("/api/v1/practice/start", headers=auth, json={"set_number": 9}).json()
    first = attempt["questions"][0]
    client.post(
        f"/api/v1/attempts/{attempt['id']}/answer",
        headers=auth,
        json={"question_id": first["id"], "selected": get_question(first["id"]).correct},
    )
    card = client.post(f"/api/v1/attempts/{attempt['id']}/submit", headers=auth).json()
    assert card["correct"] == 1
    assert card["total"] == 60
    unanswered = sum(d["unanswered"] for d in card["domain_breakdown"].values())
    assert unanswered == 59


def test_multi_select_requires_every_correct_option(client, auth):
    from app.services.content import get_questions
    from app.services.scoring import is_correct

    multi = next(q for q in get_questions().values() if q.type == "multi")
    assert is_correct(multi, multi.correct)
    assert not is_correct(multi, multi.correct[:1])          # partial
    extra = next(o["key"] for o in multi.options if o["key"] not in multi.correct)
    assert not is_correct(multi, [*multi.correct, extra])    # superset


def test_answer_validation_rejects_bad_input(client, auth):
    attempt = client.post("/api/v1/practice/start", headers=auth, json={"set_number": 10}).json()
    qid = attempt["questions"][0]["id"]

    unknown_option = client.post(
        f"/api/v1/attempts/{attempt['id']}/answer",
        headers=auth,
        json={"question_id": qid, "selected": ["Z"]},
    )
    assert unknown_option.status_code == 400

    foreign_question = client.post(
        f"/api/v1/attempts/{attempt['id']}/answer",
        headers=auth,
        json={"question_id": "does-not-exist", "selected": ["A"]},
    )
    assert foreign_question.status_code == 400


def test_review_is_refused_before_submission(client, auth):
    attempt = client.post("/api/v1/practice/start", headers=auth, json={"set_number": 11}).json()
    assert client.get(f"/api/v1/attempts/{attempt['id']}/review", headers=auth).status_code == 409
    assert client.get(f"/api/v1/attempts/{attempt['id']}/scorecard", headers=auth).status_code == 409


def test_exam_mode_is_timed_and_cannot_be_paused(client, auth):
    exam = client.post("/api/v1/exam/start", headers=auth, json={}).json()
    assert exam["mode"] == "exam"
    assert exam["total_questions"] == 60
    assert exam["can_pause"] is False
    assert exam["remaining_seconds"] == 90 * 60

    paused = client.post(f"/api/v1/attempts/{exam['id']}/pause", headers=auth)
    assert paused.status_code == 400
    assert "cannot be paused" in paused.json()["detail"]


def test_only_one_exam_may_be_open_at_a_time(client, auth):
    client.post("/api/v1/exam/start", headers=auth, json={})
    second = client.post("/api/v1/exam/start", headers=auth, json={})
    assert second.status_code == 409


def test_attempts_are_not_visible_across_accounts(client, auth):
    from tests.conftest import register

    attempt = client.post("/api/v1/practice/start", headers=auth, json={"set_number": 12}).json()
    other = register(client, "intruder@example.com")
    intruder = {"Authorization": f"Bearer {other['access_token']}"}

    assert client.get(f"/api/v1/attempts/{attempt['id']}", headers=intruder).status_code == 404
    assert (
        client.post(f"/api/v1/attempts/{attempt['id']}/submit", headers=intruder).status_code == 404
    )


def test_submitted_attempts_cannot_be_discarded(client, auth):
    attempt = client.post("/api/v1/practice/start", headers=auth, json={"set_number": 13}).json()
    client.post(f"/api/v1/attempts/{attempt['id']}/submit", headers=auth)
    assert client.delete(f"/api/v1/attempts/{attempt['id']}", headers=auth).status_code == 409


def test_diagnostic_start_returns_a_short_paper(client, auth):
    response = client.post("/api/v1/diagnostic/start", headers=auth, json={})
    assert response.status_code == 201
    body = response.json()
    assert body["mode"] == "diagnostic"
    assert body["total_questions"] == 25
    assert len(body["questions"]) == 25
    assert body["can_pause"] is True
    assert body["remaining_seconds"] is None


def test_diagnostic_resumes_rather_than_duplicating(client, auth):
    first = client.post("/api/v1/diagnostic/start", headers=auth, json={}).json()
    client.post(f"/api/v1/attempts/{first['id']}/pause", headers=auth)
    second = client.post("/api/v1/diagnostic/start", headers=auth, json={}).json()
    assert second["id"] == first["id"]
    assert second["status"] == "in_progress"


def test_focus_set_refused_with_no_prior_results(client, auth):
    response = client.post("/api/v1/focus/start", headers=auth, json={})
    assert response.status_code == 400
    assert "readiness check" in response.json()["detail"].lower()


def test_focus_set_is_weighted_toward_a_failed_domain(client, auth):
    # Fail every AAO question on a diagnostic, get everything else right.
    attempt = client.post("/api/v1/diagnostic/start", headers=auth, json={}).json()
    for q in attempt["questions"]:
        question = get_question(q["id"])
        if question.domain == "AAO":
            selected = [o["key"] for o in q["options"] if o["key"] not in question.correct][:1]
        else:
            selected = question.correct
        client.post(
            f"/api/v1/attempts/{attempt['id']}/answer",
            headers=auth,
            json={"question_id": q["id"], "selected": selected},
        )
    client.post(f"/api/v1/attempts/{attempt['id']}/submit", headers=auth)

    focus = client.post("/api/v1/focus/start", headers=auth, json={})
    assert focus.status_code == 201
    body = focus.json()
    assert body["mode"] == "practice"
    assert body["set_number"] is None

    domain_counts: dict[str, int] = {}
    for q in body["questions"]:
        domain = get_question(q["id"]).domain
        domain_counts[domain] = domain_counts.get(domain, 0) + 1

    # AAO's blueprint baseline in a 60-question set is 16; a 0%-accuracy
    # domain must be boosted meaningfully above that baseline.
    assert domain_counts.get("AAO", 0) > 16
    # Every other domain still appears — a focus set never abandons a domain
    # entirely just because the candidate is doing fine on it.
    for code in ("TDM", "CCW", "PES", "CMR"):
        assert domain_counts.get(code, 0) > 0


def test_focus_set_resumes_rather_than_duplicating(client, auth):
    attempt = client.post("/api/v1/practice/start", headers=auth, json={"set_number": 14}).json()
    _answer_all(client, auth, attempt, correct=True)
    client.post(f"/api/v1/attempts/{attempt['id']}/submit", headers=auth)

    first = client.post("/api/v1/focus/start", headers=auth, json={}).json()
    client.post(f"/api/v1/attempts/{first['id']}/pause", headers=auth)
    second = client.post("/api/v1/focus/start", headers=auth, json={}).json()
    assert second["id"] == first["id"]


def test_diagnostic_and_focus_are_pausable_not_timed(client, auth):
    attempt = client.post("/api/v1/diagnostic/start", headers=auth, json={}).json()
    paused = client.post(f"/api/v1/attempts/{attempt['id']}/pause", headers=auth)
    assert paused.status_code == 200
    assert paused.json()["status"] == "paused"

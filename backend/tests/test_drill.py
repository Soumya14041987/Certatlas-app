"""Pure logic checks for the spaced drill, objective scorecard and scenario quick mock (no database)."""
import random
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from app.services import drill
from app.services.content import get_objectives, get_questions, get_scenarios
from app.services.scoring import objective_breakdown
from app.services.set_builder import build_quick_mock

NOW = datetime(2026, 9, 19, 12, tzinfo=timezone.utc)


def _days_ago(n):
    return NOW - timedelta(days=n)


def test_miss_is_due_immediately_and_resets_streak():
    states = drill.card_states([("Q1", True, _days_ago(5)), ("Q1", True, _days_ago(4)), ("Q1", False, _days_ago(1))])
    assert states["Q1"]["streak"] == 0 and states["Q1"]["due"] <= NOW


def test_streak_extends_interval_and_masters_after_three():
    states = drill.card_states([("Q1", True, _days_ago(3)), ("Q1", True, _days_ago(2)), ("Q1", True, _days_ago(1))])
    assert states["Q1"]["mastered"] and states["Q1"]["due"] > NOW  # 7-day interval from yesterday


def test_build_drill_orders_due_before_unseen_and_caps_size():
    states = drill.card_states([("A", False, _days_ago(2)), ("B", True, _days_ago(10)), ("C", True, _days_ago(0))])
    ids = drill.build_drill(states, ["A", "B", "C", "D", "E"], NOW, 3, random.Random(1))
    assert ids[:2] == ["A", "B"] and ids[2] in {"D", "E"} and "C" not in ids  # C answered today: not due
    assert drill.summary(states, ["A", "B", "C", "D", "E"], NOW) == {
        "total": 5, "seen": 3, "unseen": 2, "mastered": 0, "due": 2,
    }


def test_objective_breakdown_counts_only_tagged_questions_weakest_first():
    tagged = [q for q in get_questions().values() if q.task][:6]
    attempt = SimpleNamespace(
        question_ids=[q.id for q in tagged] + ["D1-001"],  # an untagged legacy item is ignored
        answers=[SimpleNamespace(question_id=q.id, is_correct=i == 0) for i, q in enumerate(tagged)],
    )
    rows = objective_breakdown(attempt)
    assert sum(r["total"] for r in rows) == 6 and sum(r["correct"] for r in rows) == 1
    assert [r["percent"] for r in rows] == sorted(r["percent"] for r in rows)


def test_quick_mock_is_four_whole_scenarios_and_reproducible():
    ids = build_quick_mock("seed-1")
    assert ids == build_quick_mock("seed-1") and len(ids) == 28 and len(set(ids)) == 28
    scenarios = {get_questions()[i].scenario for i in ids}
    assert len(scenarios) == 4
    assert all(
        {q.id for q in get_questions().values() if q.scenario == s} <= set(ids) for s in scenarios
    )


def test_every_tagged_question_points_at_a_real_scenario_and_objective():
    for q in get_questions().values():
        assert not q.scenario or q.scenario in get_scenarios(), q.id
        assert not q.task or q.task in get_objectives(), q.id

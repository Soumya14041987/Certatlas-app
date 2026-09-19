"""Spaced-repetition drill state, derived from graded history (no extra tables).

A question's state is its current run of correct answers. A miss resets the run
and makes the question due immediately; each further correct answer pushes the
next review out (1, 3, 7, 14 days). Three correct in a row counts as mastered,
but mastered questions still come back once their interval elapses.
"""
from __future__ import annotations

import random
from collections.abc import Iterable, Sequence
from datetime import datetime, timedelta, timezone

INTERVAL_DAYS = (0, 1, 3, 7, 14)
MASTERED_STREAK = 3


def _aware(when: datetime) -> datetime:
    return when if when.tzinfo else when.replace(tzinfo=timezone.utc)


def card_states(events: Iterable[tuple[str, bool, datetime]]) -> dict[str, dict]:
    """``events`` are (question_id, was_correct, when) in any order."""
    states: dict[str, dict] = {}
    for qid, ok, when in sorted(events, key=lambda e: _aware(e[2])):
        state = states.setdefault(qid, {"streak": 0})
        state["streak"] = state["streak"] + 1 if ok else 0
        state["last"] = _aware(when)
    for state in states.values():
        state["due"] = state["last"] + timedelta(days=INTERVAL_DAYS[min(state["streak"], len(INTERVAL_DAYS) - 1)])
        state["mastered"] = state["streak"] >= MASTERED_STREAK
    return states


def summary(states: dict[str, dict], pool: Sequence[str], now: datetime) -> dict:
    seen = [q for q in pool if q in states]
    return {
        "total": len(pool),
        "seen": len(seen),
        "unseen": len(pool) - len(seen),
        "mastered": sum(states[q]["mastered"] for q in seen),
        "due": sum(states[q]["due"] <= now for q in seen),
    }


def build_drill(states: dict[str, dict], pool: Sequence[str], now: datetime, size: int, rng: random.Random) -> list[str]:
    """Due questions first (weakest run, then longest overdue), then unseen ones."""
    due = sorted((q for q in pool if q in states and states[q]["due"] <= now), key=lambda q: (states[q]["streak"], states[q]["due"]))
    unseen = [q for q in pool if q not in states]
    rng.shuffle(unseen)
    return (due + unseen)[:size]

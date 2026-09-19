"""Grading and scorecard construction, shared by both modes."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models import Attempt, AttemptAnswer, AttemptMode, AttemptStatus
from app.services.content import (
    Question, domain_names, get_blueprint, get_objectives, get_question, resolve_cheatsheet,
)


def is_correct(question: Question, selected: list[str]) -> bool:
    """All-or-nothing: every correct option, and no incorrect one."""
    return sorted(set(selected)) == question.correct


def grade(attempt: Attempt) -> dict:
    """Score a submitted attempt and populate its scorecard fields."""
    answers = {a.question_id: a for a in attempt.answers}
    names = domain_names()
    per_domain: dict[str, dict[str, int]] = {}
    correct_total = 0

    for qid in attempt.question_ids:
        question = get_question(qid)
        if question is None:  # content removed since the attempt began
            continue
        bucket = per_domain.setdefault(
            question.domain, {"correct": 0, "total": 0, "unanswered": 0}
        )
        bucket["total"] += 1

        answer = answers.get(qid)
        if answer is None or not answer.selected:
            bucket["unanswered"] += 1
            if answer is not None:
                answer.is_correct = False
            continue

        ok = is_correct(question, answer.selected)
        answer.is_correct = ok
        if ok:
            bucket["correct"] += 1
            correct_total += 1

    total = len(attempt.question_ids)
    percent = round(100.0 * correct_total / total, 2) if total else 0.0

    attempt.correct_count = correct_total
    attempt.total_count = total
    attempt.score_percent = percent
    attempt.passed = percent >= settings.exam_pass_percent
    attempt.domain_breakdown = {
        code: {
            **stats,
            "name": names.get(code, code),
            "percent": round(100.0 * stats["correct"] / stats["total"], 1)
            if stats["total"]
            else 0.0,
        }
        for code, stats in sorted(per_domain.items())
    }
    attempt.submitted_at = datetime.now(timezone.utc)
    return attempt.domain_breakdown


def objective_breakdown(attempt: Attempt) -> list[dict]:
    """Percent correct per exam objective (weakest first), like the official score report.

    Only questions tagged with an objective count; untagged legacy items are skipped.
    """
    objectives = get_objectives()
    answers = {a.question_id: a for a in attempt.answers}
    tally: dict[str, list[int]] = {}
    for qid in attempt.question_ids:
        question = get_question(qid)
        if question is None or question.task not in objectives:
            continue
        counts = tally.setdefault(question.task, [0, 0])
        counts[1] += 1
        answer = answers.get(qid)
        if answer is not None and answer.is_correct:
            counts[0] += 1
    rows = [
        {
            "id": oid, "title": objectives[oid]["title"], "domain": objectives[oid]["domain"],
            "correct": right, "total": total, "percent": round(100.0 * right / total, 1),
        }
        for oid, (right, total) in tally.items()
    ]
    return sorted(rows, key=lambda r: (r["percent"], r["id"]))


def scorecard(attempt: Attempt) -> dict:
    """The published result: headline figures plus where to study next."""
    breakdown = attempt.domain_breakdown or {}
    weak = sorted(
        (d for d in breakdown.items() if d[1]["total"]),
        key=lambda kv: kv[1]["percent"],
    )[:3]
    elapsed = attempt.elapsed_seconds or 0
    total = attempt.total_count or 0
    return {
        "attempt_id": attempt.id,
        "mode": attempt.mode,
        "set_number": attempt.set_number,
        "label": attempt.label,
        "score_percent": attempt.score_percent,
        "correct": attempt.correct_count,
        "total": total,
        "passed": attempt.passed,
        "pass_mark": settings.exam_pass_percent,
        "elapsed_seconds": elapsed,
        "seconds_per_question": round(elapsed / total, 1) if total else 0.0,
        "submitted_at": attempt.submitted_at.isoformat() if attempt.submitted_at else None,
        "domain_breakdown": breakdown,
        "objective_breakdown": objective_breakdown(attempt),
        "focus_areas": [
            {"code": code, "name": stats["name"], "percent": stats["percent"]}
            for code, stats in weak
        ],
    }


def review_items(attempt: Attempt, only_incorrect: bool = False) -> list[dict]:
    """Per-question review with the full teaching payload attached."""
    answers = {a.question_id: a for a in attempt.answers}
    items: list[dict] = []

    for position, qid in enumerate(attempt.question_ids):
        question = get_question(qid)
        if question is None:
            continue
        answer: AttemptAnswer | None = answers.get(qid)
        selected = answer.selected if answer else []
        correct = bool(answer and answer.is_correct)
        if only_incorrect and correct:
            continue

        payload = {
            "position": position + 1,
            "selected": selected,
            "is_correct": correct,
            "answered": bool(selected),
            "flagged": bool(answer and answer.flagged),
            "seconds_spent": answer.seconds_spent if answer else 0,
            **question.reveal(),
        }
        # Wrong and skipped answers get the cheat-sheet section inlined, so the
        # learner never has to go looking for it.
        if not correct:
            payload["cheatsheet_content"] = resolve_cheatsheet(question.cheatsheet)
        items.append(payload)

    return items


def time_limit_for(mode: str) -> int | None:
    """Exam mode is timed; practice mode is not (it supports pause instead)."""
    return settings.exam_duration_minutes * 60 if mode == AttemptMode.EXAM else None


def domain_accuracy_map(user_id: uuid.UUID, db: Session) -> dict[str, float | None]:
    """Per-domain accuracy across every attempt the user has submitted so far.

    ``None`` for a domain the user has never been scored on — kept distinct
    from a real low score, since a focus set treats "untested" as worth
    covering too, not as "doing fine".
    """
    attempts = db.scalars(
        select(Attempt).where(Attempt.user_id == user_id, Attempt.status == AttemptStatus.SUBMITTED)
    ).all()

    totals: dict[str, dict[str, int]] = {}
    for attempt in attempts:
        for code, stats in (attempt.domain_breakdown or {}).items():
            bucket = totals.setdefault(code, {"correct": 0, "total": 0})
            bucket["correct"] += stats.get("correct", 0)
            bucket["total"] += stats.get("total", 0)

    return {
        domain["code"]: (
            round(100.0 * totals[domain["code"]]["correct"] / totals[domain["code"]]["total"], 1)
            if domain["code"] in totals and totals[domain["code"]]["total"]
            else None
        )
        for domain in get_blueprint()["domains"]
    }

"""Readiness analytics: trend, per-domain mastery and study recommendations."""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.config import settings
from app.db.session import get_db
from app.models import Attempt, AttemptStatus, User
from app.services.content import domain_names, get_blueprint

router = APIRouter(prefix="/analytics", tags=["analytics"])

_READY_MARGIN = 6  # points above the pass mark before we call someone "ready"


@router.get("/overview")
def overview(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    submitted = db.scalars(
        select(Attempt)
        .where(Attempt.user_id == user.id, Attempt.status == AttemptStatus.SUBMITTED)
        .order_by(Attempt.submitted_at.asc())
    ).all()

    names = domain_names()
    weights = {d["code"]: d["weight_percent"] for d in get_blueprint()["domains"]}

    totals: dict[str, dict[str, int]] = {}
    for attempt in submitted:
        for code, stats in (attempt.domain_breakdown or {}).items():
            bucket = totals.setdefault(code, {"correct": 0, "total": 0})
            bucket["correct"] += stats.get("correct", 0)
            bucket["total"] += stats.get("total", 0)

    domains = [
        {
            "code": code,
            "name": names.get(code, code),
            "weight_percent": weights.get(code, 0),
            "correct": stats["correct"],
            "total": stats["total"],
            "percent": round(100.0 * stats["correct"] / stats["total"], 1)
            if stats["total"]
            else None,
        }
        for code, stats in sorted(totals.items())
    ]

    scores = [a.score_percent for a in submitted if a.score_percent is not None]
    recent = scores[-5:]
    average_recent = round(sum(recent) / len(recent), 1) if recent else None

    # Weighted projection: per-domain accuracy scaled by blueprint weight, which
    # is a better readiness estimate than a raw mean of past set scores.
    covered = [d for d in domains if d["percent"] is not None]
    weight_sum = sum(d["weight_percent"] for d in covered)
    projected = (
        round(sum(d["percent"] * d["weight_percent"] for d in covered) / weight_sum, 1)
        if weight_sum
        else None
    )

    weakest = sorted(covered, key=lambda d: d["percent"])[:3]
    days_left = None
    if user.target_exam_date:
        target = user.target_exam_date
        if target.tzinfo is None:
            target = target.replace(tzinfo=timezone.utc)
        days_left = (target - datetime.now(timezone.utc)).days

    if projected is None:
        readiness = "not_started"
    elif projected >= settings.exam_pass_percent + _READY_MARGIN:
        readiness = "ready"
    elif projected >= settings.exam_pass_percent:
        readiness = "borderline"
    else:
        readiness = "not_ready"

    return {
        "attempts_submitted": len(submitted),
        "practice_submitted": sum(1 for a in submitted if a.mode == "practice"),
        "exams_submitted": sum(1 for a in submitted if a.mode == "exam"),
        "questions_answered": sum(a.total_count or 0 for a in submitted),
        "best_score": max(scores) if scores else None,
        "latest_score": scores[-1] if scores else None,
        "average_recent": average_recent,
        "projected_score": projected,
        "pass_mark": settings.exam_pass_percent,
        "readiness": readiness,
        "days_until_exam": days_left,
        "domains": domains,
        "focus_areas": [{"code": d["code"], "name": d["name"], "percent": d["percent"]} for d in weakest],
        "trend": [
            {
                "attempt_id": a.id,
                "mode": a.mode,
                "label": a.label,
                "score_percent": a.score_percent,
                "submitted_at": a.submitted_at.isoformat() if a.submitted_at else None,
            }
            for a in submitted[-20:]
        ],
    }

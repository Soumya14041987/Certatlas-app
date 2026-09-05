"""Attempt lifecycle for both modes: start, answer, pause/resume, submit, review."""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.config import settings
from app.core.ratelimit import api_rate_limit
from app.db.session import get_db
from app.models import Attempt, AttemptAnswer, AttemptMode, AttemptStatus, User
from app.schemas import AnswerIn, StartExam, StartPractice
from app.services import scoring
from app.services.content import get_question
from app.services.set_builder import build_exam_paper, build_practice_set, catalogue
from app.services.set_builder import practice_set_summary

router = APIRouter(tags=["attempts"], dependencies=[Depends(api_rate_limit)])


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _owned(attempt_id: int, user: User, db: Session) -> Attempt:
    attempt = db.get(Attempt, attempt_id)
    if attempt is None or attempt.user_id != user.id:
        # Same response whether it does not exist or belongs to someone else,
        # so attempt ids are not enumerable across accounts.
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Attempt not found")
    return attempt


def _autosubmit_if_expired(attempt: Attempt, db: Session) -> Attempt:
    """Exam mode is wall-clock bounded; enforce it server-side, never in the client."""
    if attempt.is_open and attempt.time_limit_seconds is not None:
        if attempt.remaining_seconds() == 0:
            attempt.elapsed_seconds = attempt.time_limit_seconds
            attempt.status = AttemptStatus.SUBMITTED
            scoring.grade(attempt)
            db.commit()
    return attempt


def _summary(attempt: Attempt) -> dict:
    answered = sum(1 for a in attempt.answers if a.selected)
    return {
        "id": attempt.id,
        "mode": attempt.mode,
        "status": attempt.status,
        "set_number": attempt.set_number,
        "label": attempt.label,
        "total_questions": len(attempt.question_ids),
        "answered": answered,
        "cursor": attempt.cursor,
        "elapsed_seconds": attempt.live_elapsed_seconds(),
        "remaining_seconds": attempt.remaining_seconds(),
        "started_at": attempt.started_at,
        "submitted_at": attempt.submitted_at,
        "score_percent": attempt.score_percent,
        "passed": attempt.passed,
        "can_pause": attempt.mode == AttemptMode.PRACTICE,
    }


def _full(attempt: Attempt) -> dict:
    questions = []
    for position, qid in enumerate(attempt.question_ids):
        question = get_question(qid)
        if question:
            questions.append({"position": position + 1, **question.public()})
    answers = {
        a.question_id: {
            "selected": a.selected,
            "flagged": a.flagged,
            "seconds_spent": a.seconds_spent,
        }
        for a in attempt.answers
    }
    return {**_summary(attempt), "questions": questions, "answers": answers}


# --------------------------------------------------------------------------
# Practice catalogue
# --------------------------------------------------------------------------
@router.get("/practice/sets")
def list_sets(
    page: int = Query(1, ge=1),
    per_page: int = Query(30, ge=6, le=60),
    _: User = Depends(get_current_user),
) -> dict:
    return catalogue(page=page, per_page=per_page)


@router.get("/practice/sets/{set_number}")
def get_set(set_number: int, _: User = Depends(get_current_user)) -> dict:
    try:
        return practice_set_summary(set_number)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


# --------------------------------------------------------------------------
# Starting attempts
# --------------------------------------------------------------------------
@router.post("/practice/start", status_code=status.HTTP_201_CREATED)
def start_practice(
    payload: StartPractice,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    if payload.resume_existing:
        existing = db.scalar(
            select(Attempt)
            .where(
                Attempt.user_id == user.id,
                Attempt.mode == AttemptMode.PRACTICE,
                Attempt.set_number == payload.set_number,
                Attempt.status.in_([AttemptStatus.IN_PROGRESS, AttemptStatus.PAUSED]),
            )
            .order_by(Attempt.started_at.desc())
        )
        if existing:
            # Resuming restarts the clock segment; paused time is never charged.
            if existing.status == AttemptStatus.PAUSED:
                existing.status = AttemptStatus.IN_PROGRESS
                existing.resumed_at = _utcnow()
                db.commit()
            return _full(existing)

    try:
        question_ids = build_practice_set(payload.set_number)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    attempt = Attempt(
        user_id=user.id,
        mode=AttemptMode.PRACTICE,
        status=AttemptStatus.IN_PROGRESS,
        set_number=payload.set_number,
        label=f"Practice Set {payload.set_number:03d}",
        question_ids=question_ids,
        time_limit_seconds=None,  # practice is untimed; it supports pause instead
        started_at=_utcnow(),
        resumed_at=_utcnow(),
    )
    db.add(attempt)
    db.commit()
    db.refresh(attempt)
    return _full(attempt)


@router.post("/exam/start", status_code=status.HTTP_201_CREATED)
def start_exam(
    payload: StartExam,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    if not payload.acknowledge_timed:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Exam mode is timed and cannot be paused; acknowledgement is required.",
        )

    open_exam = db.scalar(
        select(Attempt).where(
            Attempt.user_id == user.id,
            Attempt.mode == AttemptMode.EXAM,
            Attempt.status == AttemptStatus.IN_PROGRESS,
        )
    )
    if open_exam:
        _autosubmit_if_expired(open_exam, db)
        if open_exam.status == AttemptStatus.IN_PROGRESS:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Exam attempt {open_exam.id} is still in progress. Finish or abandon it first.",
            )

    sitting = db.scalar(
        select(Attempt.id).where(
            Attempt.user_id == user.id, Attempt.mode == AttemptMode.EXAM
        )
    )
    seed = f"{user.id}:{_utcnow().timestamp()}:{sitting or 0}"
    attempt = Attempt(
        user_id=user.id,
        mode=AttemptMode.EXAM,
        status=AttemptStatus.IN_PROGRESS,
        set_number=None,
        label="Full mock exam",
        question_ids=build_exam_paper(seed),
        time_limit_seconds=scoring.time_limit_for(AttemptMode.EXAM),
        started_at=_utcnow(),
        resumed_at=_utcnow(),
    )
    db.add(attempt)
    db.commit()
    db.refresh(attempt)
    return _full(attempt)


# --------------------------------------------------------------------------
# Working through an attempt
# --------------------------------------------------------------------------
@router.get("/attempts")
def list_attempts(
    mode: str | None = Query(None, pattern="^(practice|exam)$"),
    status_filter: str | None = Query(None, alias="status"),
    limit: int = Query(25, ge=1, le=100),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[dict]:
    stmt = select(Attempt).where(Attempt.user_id == user.id)
    if mode:
        stmt = stmt.where(Attempt.mode == mode)
    if status_filter:
        stmt = stmt.where(Attempt.status == status_filter)
    attempts = db.scalars(stmt.order_by(Attempt.started_at.desc()).limit(limit)).all()
    return [_summary(a) for a in attempts]


@router.get("/attempts/{attempt_id}")
def get_attempt(
    attempt_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> dict:
    attempt = _autosubmit_if_expired(_owned(attempt_id, user, db), db)
    return _full(attempt)


@router.post("/attempts/{attempt_id}/answer")
def save_answer(
    attempt_id: int,
    payload: AnswerIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    attempt = _autosubmit_if_expired(_owned(attempt_id, user, db), db)
    if attempt.status != AttemptStatus.IN_PROGRESS:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Attempt is {attempt.status}; answers can only be saved while in progress.",
        )
    if payload.question_id not in attempt.question_ids:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="That question is not part of this attempt.",
        )

    question = get_question(payload.question_id)
    if question is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unknown question")

    valid_keys = {o["key"] for o in question.options}
    unknown = set(payload.selected) - valid_keys
    if unknown:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unknown option keys: {sorted(unknown)}",
        )
    if len(set(payload.selected)) > question.select_count:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"This question allows at most {question.select_count} selection(s).",
        )

    answer = db.scalar(
        select(AttemptAnswer).where(
            AttemptAnswer.attempt_id == attempt.id,
            AttemptAnswer.question_id == payload.question_id,
        )
    )
    if answer is None:
        # Column defaults are applied on flush, so seed the mutable fields here
        # rather than reading None off an unflushed instance below.
        answer = AttemptAnswer(
            attempt_id=attempt.id,
            question_id=payload.question_id,
            position=attempt.question_ids.index(payload.question_id),
            selected=[],
            flagged=False,
            seconds_spent=0,
        )
        db.add(answer)

    answer.selected = sorted(set(payload.selected))
    answer.flagged = payload.flagged
    answer.seconds_spent = max(answer.seconds_spent or 0, payload.seconds_spent)
    answer.answered_at = _utcnow()
    # The answer key is deliberately not returned here — in both modes,
    # correctness is revealed only after submission.
    db.commit()
    return {"saved": True, "question_id": payload.question_id, "selected": answer.selected}


@router.post("/attempts/{attempt_id}/cursor")
def move_cursor(
    attempt_id: int,
    position: int = Query(ge=0),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    attempt = _owned(attempt_id, user, db)
    attempt.cursor = min(position, max(len(attempt.question_ids) - 1, 0))
    db.commit()
    return {"cursor": attempt.cursor}


@router.post("/attempts/{attempt_id}/pause")
def pause(
    attempt_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> dict:
    attempt = _owned(attempt_id, user, db)
    if attempt.mode == AttemptMode.EXAM:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Exam mode mirrors the real sitting and cannot be paused.",
        )
    if attempt.status != AttemptStatus.IN_PROGRESS:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=f"Attempt is already {attempt.status}"
        )

    # Bank the running segment, then stop the clock. Paused wall-clock time is
    # never charged to the candidate.
    attempt.elapsed_seconds = attempt.live_elapsed_seconds()
    attempt.resumed_at = None
    attempt.status = AttemptStatus.PAUSED
    db.commit()
    return _summary(attempt)


@router.post("/attempts/{attempt_id}/resume")
def resume(
    attempt_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> dict:
    attempt = _owned(attempt_id, user, db)
    if attempt.status != AttemptStatus.PAUSED:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=f"Attempt is {attempt.status}, not paused"
        )
    attempt.status = AttemptStatus.IN_PROGRESS
    attempt.resumed_at = _utcnow()
    db.commit()
    return _full(attempt)


@router.post("/attempts/{attempt_id}/submit")
def submit(
    attempt_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> dict:
    attempt = _owned(attempt_id, user, db)
    if attempt.status == AttemptStatus.SUBMITTED:
        return scoring.scorecard(attempt)
    if not attempt.is_open:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=f"Attempt is {attempt.status}"
        )

    attempt.elapsed_seconds = attempt.live_elapsed_seconds()
    attempt.resumed_at = None
    attempt.status = AttemptStatus.SUBMITTED
    scoring.grade(attempt)
    db.commit()
    db.refresh(attempt)
    return scoring.scorecard(attempt)


@router.delete("/attempts/{attempt_id}", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
def abandon(
    attempt_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> None:
    attempt = _owned(attempt_id, user, db)
    if attempt.status == AttemptStatus.SUBMITTED:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A submitted attempt is part of your record and cannot be discarded.",
        )
    attempt.status = AttemptStatus.ABANDONED
    attempt.elapsed_seconds = attempt.live_elapsed_seconds()
    attempt.resumed_at = None
    db.commit()


# --------------------------------------------------------------------------
# Results
# --------------------------------------------------------------------------
@router.get("/attempts/{attempt_id}/scorecard")
def get_scorecard(
    attempt_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> dict:
    attempt = _owned(attempt_id, user, db)
    if attempt.status != AttemptStatus.SUBMITTED:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Scorecards are published on submission.",
        )
    return scoring.scorecard(attempt)


@router.get("/attempts/{attempt_id}/review")
def get_review(
    attempt_id: int,
    only_incorrect: bool = Query(False),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    attempt = _owned(attempt_id, user, db)
    if attempt.status != AttemptStatus.SUBMITTED:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Answers and explanations are revealed after submission.",
        )
    items = scoring.review_items(attempt, only_incorrect=only_incorrect)
    return {
        "attempt_id": attempt.id,
        "mode": attempt.mode,
        "label": attempt.label,
        "pass_mark": settings.exam_pass_percent,
        "count": len(items),
        "items": items,
    }

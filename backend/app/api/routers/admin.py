"""Administrator endpoints: user management and content import.

Every route here is gated by ``require_admin``; the role is stamped into the
access token and re-checked against the database on each request.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone

from fastapi import APIRouter, Body, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import require_admin
from app.core.config import CONTENT_DIR
from app.db.session import get_db
from app.models import Attempt, AttemptStatus, RefreshToken, User, UserRole
from app.schemas import UserOut
from app.services import content

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(require_admin)])


@router.get("/users", response_model=list[UserOut])
def list_users(db: Session = Depends(get_db), limit: int = 200) -> list[User]:
    return list(db.scalars(select(User).order_by(User.created_at.desc()).limit(limit)))


@router.patch("/users/{user_id}", response_model=UserOut)
def update_user(
    user_id: int,
    is_active: bool | None = Body(default=None),
    role: str | None = Body(default=None),
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> User:
    target = db.get(User, user_id)
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No such user")
    if target.id == admin.id and (is_active is False or role == UserRole.USER):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot disable or demote your own admin account.",
        )
    if role is not None:
        if role not in {UserRole.USER, UserRole.ADMIN}:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown role")
        target.role = role
    if is_active is not None:
        target.is_active = is_active
        if not is_active:
            # Disabling an account must also cut its live sessions.
            now = datetime.now(timezone.utc)
            for record in db.scalars(
                select(RefreshToken).where(
                    RefreshToken.user_id == target.id, RefreshToken.revoked_at.is_(None)
                )
            ):
                record.revoked_at = now
    db.commit()
    db.refresh(target)
    return target


@router.get("/stats")
def platform_stats(db: Session = Depends(get_db)) -> dict:
    submitted = db.scalar(
        select(func.count(Attempt.id)).where(Attempt.status == AttemptStatus.SUBMITTED)
    )
    avg = db.scalar(
        select(func.avg(Attempt.score_percent)).where(
            Attempt.status == AttemptStatus.SUBMITTED
        )
    )
    return {
        "users": db.scalar(select(func.count(User.id))),
        "active_users": db.scalar(select(func.count(User.id)).where(User.is_active.is_(True))),
        "attempts_total": db.scalar(select(func.count(Attempt.id))),
        "attempts_submitted": submitted,
        "attempts_open": db.scalar(
            select(func.count(Attempt.id)).where(
                Attempt.status.in_([AttemptStatus.IN_PROGRESS, AttemptStatus.PAUSED])
            )
        ),
        "average_score": round(avg, 2) if avg is not None else None,
        "content": content.content_stats(),
    }


@router.post("/content/questions", status_code=status.HTTP_201_CREATED)
def import_questions(payload: dict = Body(...)) -> dict:
    """Append a validated batch of questions to the bank.

    The batch is validated in full before anything is written, then persisted as
    a new file under ``content/questions/`` so it lands in version control like
    every other content change. Existing ids are rejected rather than silently
    replaced.

    Note: growing the bank rebalances how *future* practice sets are composed.
    Attempts already created are unaffected — each attempt freezes its own
    question order on the row, so a paused attempt always resumes with the
    identical paper.
    """
    items = payload.get("questions")
    name = str(payload.get("name", "")).strip() or f"import-{int(datetime.now().timestamp())}"
    if not isinstance(items, list) or not items:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Body needs a non-empty 'questions' list"
        )

    safe_name = "".join(c for c in name if c.isalnum() or c in "-_")[:60]
    path = CONTENT_DIR / "questions" / f"{safe_name}.json"
    if path.exists():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=f"{path.name} already exists"
        )

    existing = set(content.get_questions())
    for raw in items:
        try:
            content._validate(raw, path)
        except content.ContentError as exc:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
        if raw["id"] in existing:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Question id {raw['id']} already exists in the bank",
            )

    path.write_text(json.dumps({"questions": items}, indent=2) + "\n", encoding="utf-8")
    for cache in (
        content.get_questions,
        content.questions_by_domain,
        content.get_cheatsheets,
    ):
        cache.cache_clear()

    return {"imported": len(items), "file": path.name, "bank": content.content_stats()}

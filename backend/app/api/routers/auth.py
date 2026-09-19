"""Profile surface.

Registration, login, refresh, logout and OAuth all live in Supabase Auth
now — the frontend talks to it directly via supabase-js. This router's job
shrinks to the one thing Supabase's own user object doesn't carry: the
app-specific profile fields (role, full name, target exam date) that live
in ``public.profiles``.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models import Profile
from app.schemas import ProfileUpdate, UserOut

router = APIRouter(prefix="/auth", tags=["auth"])


@router.get("/me", response_model=UserOut)
def me(user: Profile = Depends(get_current_user)) -> Profile:
    return user


@router.patch("/me", response_model=UserOut)
def update_me(
    payload: ProfileUpdate,
    user: Profile = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Profile:
    if payload.full_name is not None:
        user.full_name = payload.full_name.strip()
    if payload.target_exam_date is not None:
        target = payload.target_exam_date
        user.target_exam_date = target.replace(tzinfo=None) if target.tzinfo else target
    db.commit()
    db.refresh(user)
    return user

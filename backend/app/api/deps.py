"""Shared FastAPI dependencies: current user, role gates."""
from __future__ import annotations

import uuid

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.supabase_auth import TokenError, verify_supabase_jwt
from app.db.session import get_db
from app.models import Profile, UserRole

_bearer = HTTPBearer(auto_error=False, description="Supabase Auth access token")

_UNAUTHENTICATED = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Not authenticated",
    headers={"WWW-Authenticate": "Bearer"},
)


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: Session = Depends(get_db),
) -> Profile:
    if credentials is None:
        raise _UNAUTHENTICATED
    try:
        claims = verify_supabase_jwt(credentials.credentials)
    except TokenError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(exc),
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc

    try:
        user_id = uuid.UUID(claims["sub"])
    except (KeyError, ValueError) as exc:
        raise _UNAUTHENTICATED from exc

    # The handle_new_user trigger (supabase/migrations/) creates this row at
    # sign-up time, so its absence here means something upstream is broken,
    # not that the caller is unauthenticated — but the safe response is the
    # same either way: no profile, no access.
    profile = db.get(Profile, user_id)
    if profile is None or not profile.is_active:
        raise _UNAUTHENTICATED
    return profile


def require_admin(user: Profile = Depends(get_current_user)) -> Profile:
    if user.role != UserRole.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This endpoint requires the admin role",
        )
    return user

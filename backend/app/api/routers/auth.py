"""Registration, login, refresh-token rotation and profile."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.config import settings
from app.core.ratelimit import auth_rate_limit
from app.core.security import (
    REFRESH_TOKEN,
    TokenError,
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    verify_password,
)
from app.db.session import get_db
from app.models import RefreshToken, User, UserRole
from app.schemas import LoginIn, ProfileUpdate, RefreshIn, RegisterIn, TokenPair, UserOut

router = APIRouter(prefix="/auth", tags=["auth"])

_BAD_CREDENTIALS = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Incorrect email or password",
    headers={"WWW-Authenticate": "Bearer"},
)


def _issue(db: Session, user: User, request: Request) -> TokenPair:
    """Mint an access/refresh pair and record the refresh jti for revocation."""
    refresh = create_refresh_token(user.id)
    payload = decode_token(refresh, REFRESH_TOKEN)
    db.add(
        RefreshToken(
            jti=payload["jti"],
            user_id=user.id,
            expires_at=datetime.fromtimestamp(payload["exp"], tz=timezone.utc).replace(
                tzinfo=None
            ),
            user_agent=(request.headers.get("user-agent") or "")[:255] or None,
        )
    )
    db.commit()
    return TokenPair(
        access_token=create_access_token(user.id, user.role),
        refresh_token=refresh,
        expires_in=settings.access_token_ttl_minutes * 60,
    )


@router.post(
    "/register",
    response_model=TokenPair,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(auth_rate_limit)],
)
def register(payload: RegisterIn, request: Request, db: Session = Depends(get_db)) -> TokenPair:
    email = payload.email.lower()
    if db.scalar(select(User).where(User.email == email)):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account with that email already exists",
        )
    # The very first account becomes the administrator; every later one is a
    # normal user. Promotion after that is an explicit admin action.
    first_user = db.scalar(select(User.id).limit(1)) is None
    user = User(
        email=email,
        full_name=payload.full_name,
        hashed_password=hash_password(payload.password),
        role=UserRole.ADMIN if first_user else UserRole.USER,
        last_login_at=datetime.now(timezone.utc),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return _issue(db, user, request)


@router.post("/login", response_model=TokenPair, dependencies=[Depends(auth_rate_limit)])
def login(payload: LoginIn, request: Request, db: Session = Depends(get_db)) -> TokenPair:
    user = db.scalar(select(User).where(User.email == payload.email.lower()))
    # Verify unconditionally so a missing account and a wrong password take a
    # comparable amount of time.
    placeholder = "$2b$12$" + "." * 53
    if not verify_password(payload.password, user.hashed_password if user else placeholder):
        raise _BAD_CREDENTIALS
    if user is None:
        raise _BAD_CREDENTIALS
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="This account is disabled"
        )

    user.last_login_at = datetime.now(timezone.utc)
    db.commit()
    return _issue(db, user, request)


@router.post("/refresh", response_model=TokenPair, dependencies=[Depends(auth_rate_limit)])
def refresh(payload: RefreshIn, request: Request, db: Session = Depends(get_db)) -> TokenPair:
    try:
        claims = decode_token(payload.refresh_token, REFRESH_TOKEN)
    except TokenError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)
        ) from exc

    record = db.scalar(select(RefreshToken).where(RefreshToken.jti == claims["jti"]))
    if record is None or not record.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="This session has been revoked. Please sign in again.",
        )

    user = db.get(User, int(claims["sub"]))
    if user is None or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unknown user")

    # Rotation: the presented token is retired as the new pair is minted, so a
    # stolen refresh token is usable at most once.
    record.revoked_at = datetime.now(timezone.utc)
    db.commit()
    return _issue(db, user, request)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
def logout(payload: RefreshIn, db: Session = Depends(get_db)) -> None:
    try:
        claims = decode_token(payload.refresh_token, REFRESH_TOKEN)
    except TokenError:
        return  # Already unusable; nothing to revoke.
    record = db.scalar(select(RefreshToken).where(RefreshToken.jti == claims["jti"]))
    if record and record.revoked_at is None:
        record.revoked_at = datetime.now(timezone.utc)
        db.commit()


@router.post("/logout-all", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
def logout_all(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> None:
    now = datetime.now(timezone.utc)
    for record in db.scalars(
        select(RefreshToken).where(
            RefreshToken.user_id == user.id, RefreshToken.revoked_at.is_(None)
        )
    ):
        record.revoked_at = now
    db.commit()


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)) -> User:
    return user


@router.patch("/me", response_model=UserOut)
def update_me(
    payload: ProfileUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> User:
    if payload.full_name is not None:
        user.full_name = payload.full_name.strip()
    if payload.target_exam_date is not None:
        target = payload.target_exam_date
        user.target_exam_date = target.replace(tzinfo=None) if target.tzinfo else target
    db.commit()
    db.refresh(user)
    return user


@router.get("/sessions")
def list_sessions(
    user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> list[dict]:
    """Active refresh tokens, so a user can see and revoke their own sessions."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=settings.refresh_token_ttl_days)
    records = db.scalars(
        select(RefreshToken)
        .where(RefreshToken.user_id == user.id, RefreshToken.issued_at >= cutoff)
        .order_by(RefreshToken.issued_at.desc())
    )
    return [
        {
            "id": r.id,
            "issued_at": r.issued_at.isoformat(),
            "expires_at": r.expires_at.isoformat(),
            "active": r.is_active,
            "user_agent": r.user_agent,
        }
        for r in records
    ]

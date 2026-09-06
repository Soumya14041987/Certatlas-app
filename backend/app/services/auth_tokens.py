"""Shared access/refresh token issuance, used by password and OAuth sign-in."""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import Request
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import (
    REFRESH_TOKEN,
    create_access_token,
    create_refresh_token,
    decode_token,
)
from app.models import RefreshToken, User
from app.schemas import TokenPair


def issue_token_pair(db: Session, user: User, request: Request) -> TokenPair:
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

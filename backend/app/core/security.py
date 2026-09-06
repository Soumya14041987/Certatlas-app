"""Password hashing and JWT issuance / verification."""
from __future__ import annotations

import base64
import hashlib
import re
import uuid
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt

from app.core.config import settings

ACCESS_TOKEN = "access"  # noqa: S105 - token *type* label, not a secret
REFRESH_TOKEN = "refresh"  # noqa: S105
OAUTH_STATE_TOKEN = "oauth_state"  # noqa: S105


class TokenError(Exception):
    """Raised when a token is missing, malformed, expired or of the wrong type."""


# --------------------------------------------------------------------------
# Passwords
# --------------------------------------------------------------------------
def _prehash(password: str) -> bytes:
    """bcrypt silently truncates at 72 bytes; SHA-256 + base64 keeps entropy."""
    digest = hashlib.sha256(password.encode("utf-8")).digest()
    return base64.b64encode(digest)


def hash_password(password: str) -> str:
    salt = bcrypt.gensalt(rounds=settings.bcrypt_rounds)
    return bcrypt.hashpw(_prehash(password), salt).decode("utf-8")


def verify_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(_prehash(password), hashed.encode("utf-8"))
    except (ValueError, TypeError):
        return False


_PASSWORD_RULES = (
    (re.compile(r"[a-z]"), "one lowercase letter"),
    (re.compile(r"[A-Z]"), "one uppercase letter"),
    (re.compile(r"[0-9]"), "one digit"),
    (re.compile(r"[^A-Za-z0-9]"), "one symbol"),
)


def password_problems(password: str) -> list[str]:
    """Return a list of unmet policy requirements (empty list == acceptable)."""
    problems: list[str] = []
    if len(password) < settings.password_min_length:
        problems.append(f"at least {settings.password_min_length} characters")
    for pattern, label in _PASSWORD_RULES:
        if not pattern.search(password):
            problems.append(label)
    return problems


# --------------------------------------------------------------------------
# Tokens
# --------------------------------------------------------------------------
def _encode(subject: str, token_type: str, ttl: timedelta, **claims: object) -> str:
    now = datetime.now(timezone.utc)
    payload: dict[str, object] = {
        "sub": subject,
        "typ": token_type,
        "iat": int(now.timestamp()),
        "exp": int((now + ttl).timestamp()),
        "jti": uuid.uuid4().hex,
        "iss": settings.app_name,
        **claims,
    }
    return jwt.encode(payload, settings.secret_key, algorithm=settings.jwt_algorithm)


def create_access_token(user_id: int, role: str) -> str:
    return _encode(
        str(user_id),
        ACCESS_TOKEN,
        timedelta(minutes=settings.access_token_ttl_minutes),
        role=role,
    )


def create_refresh_token(user_id: int) -> str:
    return _encode(
        str(user_id), REFRESH_TOKEN, timedelta(days=settings.refresh_token_ttl_days)
    )


def create_oauth_state_token(provider: str) -> str:
    """Short-lived, signed CSRF token for the OAuth redirect round trip.

    Carries no server-side session: the same value is sent both as the
    provider's ``state`` parameter and as an httponly cookie, and the
    callback rejects the request unless they match and the signature/expiry
    check out.
    """
    return _encode(provider, OAUTH_STATE_TOKEN, timedelta(minutes=10))


def decode_token(token: str, expected_type: str) -> dict:
    try:
        payload = jwt.decode(
            token,
            settings.secret_key,
            algorithms=[settings.jwt_algorithm],
            issuer=settings.app_name,
        )
    except jwt.ExpiredSignatureError as exc:
        raise TokenError("Token has expired") from exc
    except jwt.InvalidTokenError as exc:
        raise TokenError("Token is invalid") from exc

    if payload.get("typ") != expected_type:
        raise TokenError(f"Expected a {expected_type} token")
    if not payload.get("sub"):
        raise TokenError("Token is missing a subject")
    return payload

"""Verification of Supabase Auth JWTs.

This app never issues or refreshes tokens any more — the frontend obtains
them directly from Supabase Auth (password sign-in, Google, GitHub, all
handled by supabase-js). Every protected endpoint just needs to confirm a
bearer token is a genuine, unexpired Supabase-issued token and read who it
belongs to; ``api/deps.py`` then loads that person's ``Profile`` row.

Verification is via Supabase's JWKS endpoint (asymmetric keys) rather than a
shared HS256 secret — Supabase's own docs recommend this over shared-secret
verification for third-party backends.
"""
from __future__ import annotations

import jwt
from jwt import PyJWKClient

from app.core.config import settings


class TokenError(Exception):
    """Raised when a bearer token is missing, malformed, or expired."""


_jwks_client: PyJWKClient | None = None


def _client() -> PyJWKClient:
    global _jwks_client
    if _jwks_client is None:
        if not settings.supabase_jwks_url:
            raise TokenError("CCARF_SUPABASE_URL is not configured")
        _jwks_client = PyJWKClient(settings.supabase_jwks_url, cache_keys=True)
    return _jwks_client


def verify_supabase_jwt(token: str) -> dict:
    """Return the token's claims, or raise ``TokenError``.

    Claims of interest: ``sub`` (the user's UUID in ``auth.users``),
    ``email``, ``role`` (the Postgres role Supabase issued the token
    under — always ``authenticated`` for a signed-in user; this app's own
    admin/user role lives in ``profiles.role``, not this claim).
    """
    try:
        signing_key = _client().get_signing_key_from_jwt(token)
        return jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256", "ES256"],
            audience="authenticated",
            options={"require": ["sub", "exp"]},
        )
    except jwt.ExpiredSignatureError as exc:
        raise TokenError("Token has expired") from exc
    except jwt.InvalidTokenError as exc:
        raise TokenError("Token is invalid") from exc
    except Exception as exc:  # PyJWKClientError et al. — treat as auth failure
        raise TokenError(f"Could not verify token: {exc}") from exc

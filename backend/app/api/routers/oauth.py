"""Sign in with Google or GitHub (OAuth 2.0 authorization-code flow).

Both providers redirect back to ``/auth/oauth/{provider}/callback``, which
exchanges the code for the caller's verified email, finds or creates the
matching ``User``, and hands the browser its own access/refresh pair via a
redirect to the frontend's ``/oauth/callback`` route (tokens in the URL
fragment, so they never reach a server access log).
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.ratelimit import auth_rate_limit
from app.core.security import OAUTH_STATE_TOKEN, TokenError, create_oauth_state_token, decode_token
from app.db.session import get_db
from app.models import User, UserRole
from app.services.auth_tokens import issue_token_pair

router = APIRouter(prefix="/auth/oauth", tags=["auth"])

_STATE_COOKIE = "ccarf_oauth_state"


@dataclass(frozen=True)
class _Provider:
    name: str
    client_id: str | None
    client_secret: str | None
    authorize_url: str
    token_url: str
    scope: str


def _provider(name: str) -> _Provider:
    if name == "google":
        return _Provider(
            "google", settings.google_client_id, settings.google_client_secret,
            "https://accounts.google.com/o/oauth2/v2/auth",
            "https://oauth2.googleapis.com/token",
            "openid email profile",
        )
    if name == "github":
        return _Provider(
            "github", settings.github_client_id, settings.github_client_secret,
            "https://github.com/login/oauth/authorize",
            "https://github.com/login/oauth/access_token",
            "read:user user:email",
        )
    raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Unknown OAuth provider")


def _redirect_uri(provider: str) -> str:
    return f"{settings.public_base_url}{settings.api_prefix}/auth/oauth/{provider}/callback"


def _to_frontend(path: str) -> str:
    return f"{settings.frontend_base_url}{path}"


def _not_configured(provider: _Provider) -> HTTPException:
    return HTTPException(
        status.HTTP_503_SERVICE_UNAVAILABLE,
        detail=f"Sign in with {provider.name.capitalize()} is not configured on this server",
    )


@router.get("/{provider}/start", dependencies=[Depends(auth_rate_limit)])
def start(provider: str) -> RedirectResponse:
    config = _provider(provider)
    if not (config.client_id and config.client_secret):
        raise _not_configured(config)

    state = create_oauth_state_token(config.name)
    params = {
        "client_id": config.client_id,
        "redirect_uri": _redirect_uri(config.name),
        "response_type": "code",
        "scope": config.scope,
        "state": state,
    }
    if config.name == "google":
        params["access_type"] = "online"
        params["prompt"] = "select_account"

    response = RedirectResponse(
        f"{config.authorize_url}?{urlencode(params)}", status_code=status.HTTP_302_FOUND
    )
    response.set_cookie(
        _STATE_COOKIE, state, max_age=600, httponly=True, samesite="lax",
        secure=settings.is_production,
    )
    return response


async def _google_identity(config: _Provider, code: str) -> tuple[str, str | None, str]:
    async with httpx.AsyncClient(timeout=10) as client:
        token = await client.post(
            config.token_url,
            data={
                "code": code,
                "client_id": config.client_id,
                "client_secret": config.client_secret,
                "redirect_uri": _redirect_uri("google"),
                "grant_type": "authorization_code",
            },
            headers={"Accept": "application/json"},
        )
        token.raise_for_status()
        info = await client.get(
            "https://openidconnect.googleapis.com/v1/userinfo",
            headers={"Authorization": f"Bearer {token.json()['access_token']}"},
        )
        info.raise_for_status()
        profile = info.json()

    email = profile.get("email") if profile.get("email_verified") else None
    name = profile.get("name") or (email.split("@")[0] if email else "Google user")
    return profile["sub"], email, name


async def _github_identity(config: _Provider, code: str) -> tuple[str, str | None, str]:
    async with httpx.AsyncClient(timeout=10) as client:
        token = await client.post(
            config.token_url,
            data={
                "code": code,
                "client_id": config.client_id,
                "client_secret": config.client_secret,
                "redirect_uri": _redirect_uri("github"),
            },
            headers={"Accept": "application/json"},
        )
        token.raise_for_status()
        payload = token.json()
        if "access_token" not in payload:
            raise HTTPException(
                status.HTTP_502_BAD_GATEWAY, detail="GitHub did not return an access token"
            )
        headers = {
            "Authorization": f"Bearer {payload['access_token']}",
            "Accept": "application/vnd.github+json",
        }
        user_resp = await client.get("https://api.github.com/user", headers=headers)
        user_resp.raise_for_status()
        profile = user_resp.json()

        email = profile.get("email")
        if not email:
            emails_resp = await client.get("https://api.github.com/user/emails", headers=headers)
            if emails_resp.status_code == 200:
                for entry in emails_resp.json():
                    if entry.get("primary") and entry.get("verified"):
                        email = entry["email"]
                        break

    name = profile.get("name") or profile.get("login") or "GitHub user"
    return str(profile["id"]), email, name


@router.get("/{provider}/callback", dependencies=[Depends(auth_rate_limit)])
async def callback(
    provider: str,
    request: Request,
    code: str | None = Query(default=None),
    state: str | None = Query(default=None),
    error: str | None = Query(default=None),
    db: Session = Depends(get_db),
) -> RedirectResponse:
    config = _provider(provider)

    def failure(message: str) -> RedirectResponse:
        redirect = RedirectResponse(
            _to_frontend(f"/login?{urlencode({'oauth_error': message})}"),
            status_code=status.HTTP_302_FOUND,
        )
        redirect.delete_cookie(_STATE_COOKIE)
        return redirect

    if error:
        return failure(f"{config.name.capitalize()} sign-in was cancelled")
    if not code or not state:
        return failure("Missing OAuth response")

    cookie_state = request.cookies.get(_STATE_COOKIE)
    if not cookie_state or cookie_state != state:
        return failure("Sign-in session expired — please try again")
    try:
        claims = decode_token(state, OAUTH_STATE_TOKEN)
    except TokenError:
        return failure("Sign-in session expired — please try again")
    if claims["sub"] != config.name:
        return failure("Sign-in session expired — please try again")

    if not (config.client_id and config.client_secret):
        return failure(f"Sign in with {config.name.capitalize()} is not configured on this server")

    try:
        if config.name == "google":
            subject, email, name = await _google_identity(config, code)
        else:
            subject, email, name = await _github_identity(config, code)
    except httpx.HTTPError:
        return failure(f"Could not complete sign-in with {config.name.capitalize()}")

    if not email:
        return failure(
            f"Your {config.name.capitalize()} account has no verified email to sign in with"
        )
    email = email.lower()

    user = db.scalar(
        select(User).where(User.oauth_provider == config.name, User.oauth_subject == subject)
    )
    if user is None:
        user = db.scalar(select(User).where(User.email == email))
        if user is not None:
            # An existing password account signing in with a provider that
            # verifies the same email — link it rather than duplicating it.
            user.oauth_provider = config.name
            user.oauth_subject = subject
        else:
            first_user = db.scalar(select(User.id).limit(1)) is None
            user = User(
                email=email,
                full_name=name,
                hashed_password=None,
                oauth_provider=config.name,
                oauth_subject=subject,
                role=UserRole.ADMIN if first_user else UserRole.USER,
            )
            db.add(user)

    if not user.is_active:
        return failure("This account is disabled")

    user.last_login_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(user)

    pair = issue_token_pair(db, user, request)
    redirect = RedirectResponse(
        _to_frontend(
            "/oauth/callback#"
            + urlencode(
                {
                    "access_token": pair.access_token,
                    "refresh_token": pair.refresh_token,
                    "expires_in": pair.expires_in,
                }
            )
        ),
        status_code=status.HTTP_302_FOUND,
    )
    redirect.delete_cookie(_STATE_COOKIE)
    return redirect

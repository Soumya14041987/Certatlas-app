"""Application configuration, loaded from environment / .env."""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Annotated

from pydantic import field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent  # .../backend/app
CONTENT_DIR = BASE_DIR / "content"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", "../.env"), env_prefix="CCARF_", extra="ignore"
    )

    # --- Identity -------------------------------------------------------
    app_name: str = "CertAtlas"
    environment: str = "development"
    debug: bool = True
    api_prefix: str = "/api/v1"

    # --- CORS -----------------------------------------------------------
    cors_origins: Annotated[list[str], NoDecode] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ]

    # --- Persistence ------------------------------------------------------
    # Supabase's Postgres connection string (session pooler). SQLite is kept
    # as the fallback default only so a bare checkout with no .env still
    # imports cleanly; the app is not meant to run against it any more.
    database_url: str = "sqlite:///./ccarf.db"

    # --- Supabase Auth ----------------------------------------------------
    # Identity, credentials and sessions are Supabase's job now. This app
    # only ever verifies a bearer token the frontend already obtained,
    # against the JWKS endpoint this URL derives — see
    # core/supabase_auth.py. Nothing here can issue or refresh a token.
    supabase_url: str | None = None

    # Root-equivalent (bypasses RLS and Auth) — never read outside tests/.
    # Used only to create/delete throwaway auth users as pytest fixtures via
    # Supabase's Admin API, since a real profiles/attempts row is now
    # FK-constrained to a real auth.users row. Must never reach the
    # frontend or any VITE_-prefixed variable.
    supabase_service_role_key: str | None = None

    @property
    def supabase_jwks_url(self) -> str | None:
        if not self.supabase_url:
            return None
        return f"{self.supabase_url.rstrip('/')}/auth/v1/.well-known/jwks.json"

    # --- Rate limiting (fixed window, per client+route) ------------------
    rate_limit_enabled: bool = True
    rate_limit_auth_per_minute: int = 10
    rate_limit_default_per_minute: int = 240

    # --- Exam engine ----------------------------------------------------
    exam_question_count: int = 60
    exam_duration_minutes: int = 120
    quick_mock_minutes: int = 56
    quick_mock_scenarios: int = 4
    exam_pass_percent: int = 72
    practice_set_count: int = 300
    practice_set_size: int = 60
    diagnostic_question_count: int = 25

    # --- "What's new" feed: Anthropic/Claude release videos from YouTube ----
    # Feature is hidden (not just empty) until this is set.
    youtube_api_key: str | None = None
    youtube_channel_handle: str = "@anthropic-ai"
    updates_cache_ttl_minutes: int = 360
    updates_max_results: int = 24

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _split_origins(cls, v: object) -> object:
        if isinstance(v, str):
            return [o.strip() for o in v.split(",") if o.strip()]
        return v

    @property
    def is_production(self) -> bool:
        return self.environment.lower() in {"production", "prod"}


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()

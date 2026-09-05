"""Application configuration, loaded from environment / .env."""
from __future__ import annotations

import secrets
from functools import lru_cache
from pathlib import Path

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent  # .../backend/app
CONTENT_DIR = BASE_DIR / "content"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", "../.env"), env_prefix="CCARF_", extra="ignore"
    )

    # --- Identity -------------------------------------------------------
    app_name: str = "CCAR-F Exam Prep"
    environment: str = "development"
    debug: bool = True
    api_prefix: str = "/api/v1"

    # --- Security -------------------------------------------------------
    # Generated per-process when unset. Production MUST set CCARF_SECRET_KEY,
    # otherwise every restart invalidates all issued tokens.
    secret_key: str = Field(default_factory=lambda: secrets.token_urlsafe(64))
    jwt_algorithm: str = "HS256"
    access_token_ttl_minutes: int = 30
    refresh_token_ttl_days: int = 14
    bcrypt_rounds: int = 12
    password_min_length: int = 10

    # --- CORS -----------------------------------------------------------
    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]

    # --- Persistence ----------------------------------------------------
    database_url: str = "sqlite:///./ccarf.db"

    # --- Rate limiting (fixed window, per client+route) ------------------
    rate_limit_enabled: bool = True
    rate_limit_auth_per_minute: int = 10
    rate_limit_default_per_minute: int = 240

    # --- Exam engine ----------------------------------------------------
    exam_question_count: int = 60
    exam_duration_minutes: int = 90
    exam_pass_percent: int = 72
    practice_set_count: int = 300
    practice_set_size: int = 60

    # --- Bootstrap admin (created by seed.py only when both are set) -----
    first_admin_email: str | None = None
    first_admin_password: str | None = None

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

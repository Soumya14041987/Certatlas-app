"""FastAPI application factory and wiring."""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.core.config import settings
from app.db.session import init_db
from app.services.content import ContentError, content_stats

logger = logging.getLogger("ccarf")

DESCRIPTION = """
**CertAtlas** — an exam preparation platform, currently covering
**CCAR-F — Claude Code Architect Foundations**.

* **Practice mode** — 300 blueprint-weighted sets of 60 questions, pausable,
  with a published scorecard for every attempt.
* **Exam mode** — a timed 60-question mock sitting under real conditions.
* Wrong answers are returned with the explanation, a real-world analogy, a code
  snippet and the relevant cheat-sheet section inlined.

Content is community-authored study material. It is not affiliated with,
endorsed by, or sourced from Anthropic, and contains no real exam questions.
"""


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    try:
        stats = content_stats()
    except ContentError:  # pragma: no cover - fail fast on a bad bank
        logger.exception("Question bank failed validation")
        raise
    logger.info(
        "Content loaded: %s questions, %s cheat sheets, %s courses",
        stats["total_questions"],
        stats["cheatsheets"],
        stats["courses"],
    )
    if settings.is_production and not settings.rate_limit_enabled:
        logger.warning("Rate limiting is disabled in a production environment")
    yield


def create_app() -> FastAPI:
    app = FastAPI(
        title=settings.app_name,
        description=DESCRIPTION,
        version="1.0.0",
        lifespan=lifespan,
        docs_url="/docs" if not settings.is_production else None,
        redoc_url=None,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type"],
    )

    @app.middleware("http")
    async def security_headers(request: Request, call_next):
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "no-referrer")
        response.headers.setdefault(
            "Permissions-Policy", "geolocation=(), microphone=(), camera=()"
        )
        if settings.is_production:
            response.headers.setdefault(
                "Strict-Transport-Security", "max-age=31536000; includeSubDomains"
            )
        return response

    @app.exception_handler(ContentError)
    async def content_error(_: Request, exc: ContentError) -> JSONResponse:
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={"detail": f"Content bank error: {exc}"},
        )

    # Routers are imported here so the module stays importable without a DB.
    from app.api.routers import admin, analytics, attempts, auth, catalog, updates

    for router in (
        auth.router, catalog.router, attempts.router, analytics.router,
        admin.router, updates.router,
    ):
        app.include_router(router, prefix=settings.api_prefix)

    @app.get("/health", tags=["meta"])
    def health() -> dict:
        return {"status": "ok", "environment": settings.environment, "version": app.version}

    @app.get("/", tags=["meta"])
    def root() -> dict:
        return {
            "name": settings.app_name,
            "exam": "CCAR-F — Claude Code Architect Foundations",
            "api": settings.api_prefix,
            "docs": "/docs" if not settings.is_production else None,
            "disclaimer": (
                "Community-authored study material. Not affiliated with or endorsed by "
                "Anthropic. Contains no real exam questions."
            ),
        }

    return app


app = create_app()

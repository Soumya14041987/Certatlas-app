"""SQLAlchemy engine / session wiring.

Production points ``CCARF_DATABASE_URL`` at Supabase's Postgres connection
string; the SQLite fallback below only exists so a checkout with no
``.env`` still imports and runs the parts of the app (content bank,
question sampling) that need no database at all.
"""
from __future__ import annotations

from collections.abc import Iterator

from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core.config import settings

_is_sqlite = settings.database_url.startswith("sqlite")

engine = create_engine(
    settings.database_url,
    echo=False,
    future=True,
    pool_pre_ping=not _is_sqlite,
    connect_args={"check_same_thread": False} if _is_sqlite else {},
)

if _is_sqlite:

    @event.listens_for(engine, "connect")
    def _sqlite_pragmas(dbapi_connection, _record):  # noqa: ANN001
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()


SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def get_db() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    """Create tables — SQLite fallback only.

    Against Postgres, the schema is owned entirely by
    ``supabase/migrations/*.sql`` (applied with the Supabase CLI or direct
    ``psql``/``psycopg``), not by this app. Calling ``create_all`` there
    would risk silently drifting from what the migrations actually define
    every time the app boots, so it's skipped outright rather than relying
    on SQLAlchemy's create-if-missing check to make that safe by accident.
    """
    from app import models  # noqa: F401  (registers mappers)

    if _is_sqlite:
        Base.metadata.create_all(bind=engine)

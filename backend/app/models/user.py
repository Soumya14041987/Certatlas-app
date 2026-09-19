"""Profile and bookmark tables.

Identity, credentials and sessions live entirely in Supabase Auth's own
``auth.users`` table now — this app never reads or writes it directly. A
``Profile`` row (same primary key as ``auth.users.id``, created by the
``handle_new_user`` Postgres trigger on sign-up — see
``supabase/migrations/``) carries the fields Supabase Auth doesn't: role,
display name, exam-readiness preferences.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from enum import StrEnum

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class UserRole(StrEnum):
    USER = "user"
    ADMIN = "admin"


class Profile(Base):
    __tablename__ = "profiles"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    email: Mapped[str] = mapped_column(String(320))
    full_name: Mapped[str] = mapped_column(String(160), default="")
    role: Mapped[str] = mapped_column(String(16), default=UserRole.USER)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    target_exam_date: Mapped[datetime | None] = mapped_column(DateTime, default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime, default=None)

    attempts: Mapped[list["Attempt"]] = relationship(  # noqa: F821
        back_populates="user", cascade="all, delete-orphan"
    )
    bookmarks: Mapped[list["Bookmark"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )

    @property
    def is_admin(self) -> bool:
        return self.role == UserRole.ADMIN


class Bookmark(Base):
    """A question the learner explicitly parked for later review."""

    __tablename__ = "bookmarks"
    __table_args__ = (
        Index("ix_bookmark_user_question", "user_id", "question_id", unique=True),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("profiles.id", ondelete="CASCADE"), index=True
    )
    question_id: Mapped[str] = mapped_column(String(64))
    note: Mapped[str | None] = mapped_column(String(1000), default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)

    user: Mapped[Profile] = relationship(back_populates="bookmarks")

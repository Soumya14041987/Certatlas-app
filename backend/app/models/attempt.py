"""Attempt + per-question answer tables shared by Practice and Exam modes."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from enum import StrEnum

from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class AttemptMode(StrEnum):
    PRACTICE = "practice"
    EXAM = "exam"
    DIAGNOSTIC = "diagnostic"


class AttemptStatus(StrEnum):
    IN_PROGRESS = "in_progress"
    PAUSED = "paused"
    SUBMITTED = "submitted"
    ABANDONED = "abandoned"


class Attempt(Base):
    __tablename__ = "attempts"
    __table_args__ = (
        Index("ix_attempt_user_status", "user_id", "status"),
        Index("ix_attempt_user_mode", "user_id", "mode"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("profiles.id", ondelete="CASCADE"), index=True
    )
    mode: Mapped[str] = mapped_column(String(16))
    status: Mapped[str] = mapped_column(String(16), default=AttemptStatus.IN_PROGRESS)

    # Practice only: which of the 300 generated sets this attempt runs.
    set_number: Mapped[int | None] = mapped_column(Integer, default=None, index=True)
    label: Mapped[str] = mapped_column(String(120), default="")

    # Frozen ordering, so a paused attempt resumes with the identical paper.
    question_ids: Mapped[list[str]] = mapped_column(JSONB, default=list)
    cursor: Mapped[int] = mapped_column(Integer, default=0)

    # Timing. ``elapsed_seconds`` accumulates only while running, so Pause is
    # honest: wall-clock time spent paused is never charged to the candidate.
    started_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)
    resumed_at: Mapped[datetime | None] = mapped_column(DateTime, default=_utcnow)
    elapsed_seconds: Mapped[int] = mapped_column(Integer, default=0)
    time_limit_seconds: Mapped[int | None] = mapped_column(Integer, default=None)
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime, default=None)

    # Scorecard (populated on submit).
    score_percent: Mapped[float | None] = mapped_column(Float, default=None)
    correct_count: Mapped[int | None] = mapped_column(Integer, default=None)
    total_count: Mapped[int | None] = mapped_column(Integer, default=None)
    passed: Mapped[bool | None] = mapped_column(Boolean, default=None)
    domain_breakdown: Mapped[dict | None] = mapped_column(JSONB, default=None)

    user: Mapped["Profile"] = relationship(back_populates="attempts")  # noqa: F821
    answers: Mapped[list["AttemptAnswer"]] = relationship(
        back_populates="attempt",
        cascade="all, delete-orphan",
        order_by="AttemptAnswer.position",
    )

    @property
    def is_open(self) -> bool:
        return self.status in {AttemptStatus.IN_PROGRESS, AttemptStatus.PAUSED}

    def live_elapsed_seconds(self, now: datetime | None = None) -> int:
        """Elapsed time including the currently running segment."""
        total = self.elapsed_seconds
        if self.status == AttemptStatus.IN_PROGRESS and self.resumed_at:
            now = now or _utcnow()
            resumed = self.resumed_at
            if resumed.tzinfo is None:
                resumed = resumed.replace(tzinfo=timezone.utc)
            total += max(0, int((now - resumed).total_seconds()))
        return total

    def remaining_seconds(self, now: datetime | None = None) -> int | None:
        if self.time_limit_seconds is None:
            return None
        return max(0, self.time_limit_seconds - self.live_elapsed_seconds(now))


class AttemptAnswer(Base):
    __tablename__ = "attempt_answers"
    __table_args__ = (
        Index("ix_answer_attempt_question", "attempt_id", "question_id", unique=True),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    attempt_id: Mapped[int] = mapped_column(
        ForeignKey("attempts.id", ondelete="CASCADE"), index=True
    )
    question_id: Mapped[str] = mapped_column(String(64), index=True)
    position: Mapped[int] = mapped_column(Integer, default=0)

    selected: Mapped[list[str]] = mapped_column(JSONB, default=list)
    is_correct: Mapped[bool | None] = mapped_column(Boolean, default=None)
    flagged: Mapped[bool] = mapped_column(Boolean, default=False)
    seconds_spent: Mapped[int] = mapped_column(Integer, default=0)
    answered_at: Mapped[datetime | None] = mapped_column(DateTime, default=None)

    attempt: Mapped[Attempt] = relationship(back_populates="answers")

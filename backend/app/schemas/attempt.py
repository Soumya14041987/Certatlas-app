from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class StartPractice(BaseModel):
    set_number: int = Field(ge=1, le=1000)
    resume_existing: bool = True


class StartExam(BaseModel):
    acknowledge_timed: bool = Field(
        default=True,
        description="Exam mode is timed and cannot be paused; the client confirms the candidate knows.",
    )
    quick: bool = Field(
        default=False,
        description="A ~28-question scenario mock (4 random scenarios, 56 minutes) instead of the full paper.",
    )


class AnswerIn(BaseModel):
    question_id: str = Field(min_length=1, max_length=64)
    selected: list[str] = Field(default_factory=list, max_length=8)
    flagged: bool = False
    seconds_spent: int = Field(default=0, ge=0, le=86_400)


class AttemptSummary(BaseModel):
    id: int
    mode: str
    status: str
    set_number: int | None
    label: str
    total_questions: int
    answered: int
    cursor: int
    elapsed_seconds: int
    remaining_seconds: int | None
    started_at: datetime
    submitted_at: datetime | None
    score_percent: float | None
    passed: bool | None


class AttemptOut(AttemptSummary):
    questions: list[dict]
    answers: dict[str, dict]

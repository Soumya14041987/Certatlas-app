"""Blueprint, curriculum and cheat-sheet endpoints."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.api.deps import get_current_user
from app.core.config import settings
from app.models import Profile
from app.services.content import (
    content_stats,
    get_blueprint,
    get_cheatsheets,
    get_courses,
    get_heuristics,
    get_questions,
)

router = APIRouter(tags=["catalog"])


@router.get("/blueprint")
def blueprint() -> dict:
    """Public: domains, weightings, objectives and exam mechanics."""
    return {
        **get_blueprint(),
        "practice_sets": settings.practice_set_count,
        "practice_set_size": settings.practice_set_size,
        "bank": content_stats(),
    }


@router.get("/courses")
def courses() -> dict:
    """Public: the curriculum map and the six-week study plan."""
    return get_courses()


@router.get("/heuristics")
def heuristics(_: Profile = Depends(get_current_user)) -> dict:
    """Exam Instincts: pattern-recognition rules for reading a question fast.

    Not exam content on its own — a shortcut for mapping a question's wording
    onto the mechanism it tests, before reading the options. Gated behind auth
    like the cheat sheets, since it is study material for registered users.
    """
    return get_heuristics()


@router.get("/cheatsheets")
def list_cheatsheets(_: Profile = Depends(get_current_user)) -> list[dict]:
    return [
        {
            "slug": s.slug,
            "domain": s.domain,
            "title": s.title,
            "summary": s.summary,
            "anchors": sorted(s.sections),
        }
        for s in sorted(get_cheatsheets().values(), key=lambda s: s.slug)
    ]


@router.get("/cheatsheets/{slug}")
def read_cheatsheet(
    slug: str,
    anchor: str | None = Query(None),
    _: Profile = Depends(get_current_user),
) -> dict:
    sheet = get_cheatsheets().get(slug)
    if sheet is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No such cheat sheet")
    return sheet.as_dict(anchor)


@router.get("/questions/{question_id}")
def question_detail(question_id: str, _: Profile = Depends(get_current_user)) -> dict:
    """Full reveal for a single item — used by the bookmark/review views.

    Only reachable by authenticated users, and never used to serve a live
    attempt: attempts always go through the public() projection.
    """
    question = get_questions().get(question_id)
    if question is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unknown question")
    return question.reveal()

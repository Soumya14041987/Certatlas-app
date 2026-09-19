"""Administrator endpoints: user management and content import.

Every route here is gated by ``require_admin``, which re-checks the role
against ``public.profiles`` on each request — never trusted from the token
alone (the Supabase JWT's own ``role`` claim is a Postgres role for RLS,
not this app's admin/user distinction).
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Body, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import require_admin
from app.core.config import CONTENT_DIR
from app.db.session import get_db
from app.models import Attempt, AttemptStatus, Profile, UserRole
from app.schemas import UserOut
from app.services import content
from app.services import updates as updates_service

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(require_admin)])


@router.get("/users", response_model=list[UserOut])
def list_users(db: Session = Depends(get_db), limit: int = 200) -> list[Profile]:
    return list(db.scalars(select(Profile).order_by(Profile.created_at.desc()).limit(limit)))


@router.patch("/users/{user_id}", response_model=UserOut)
def update_user(
    user_id: uuid.UUID,
    is_active: bool | None = Body(default=None),
    role: str | None = Body(default=None),
    admin: Profile = Depends(require_admin),
    db: Session = Depends(get_db),
) -> Profile:
    target = db.get(Profile, user_id)
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No such user")
    if target.id == admin.id and (is_active is False or role == UserRole.USER):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot disable or demote your own admin account.",
        )
    if role is not None:
        if role not in {UserRole.USER, UserRole.ADMIN}:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown role")
        target.role = role
    if is_active is not None:
        target.is_active = is_active
    db.commit()
    db.refresh(target)
    return target


@router.get("/stats")
def platform_stats(db: Session = Depends(get_db)) -> dict:
    submitted = db.scalar(
        select(func.count(Attempt.id)).where(Attempt.status == AttemptStatus.SUBMITTED)
    )
    avg = db.scalar(
        select(func.avg(Attempt.score_percent)).where(
            Attempt.status == AttemptStatus.SUBMITTED
        )
    )
    return {
        "users": db.scalar(select(func.count(Profile.id))),
        "active_users": db.scalar(
            select(func.count(Profile.id)).where(Profile.is_active.is_(True))
        ),
        "attempts_total": db.scalar(select(func.count(Attempt.id))),
        "attempts_submitted": submitted,
        "attempts_open": db.scalar(
            select(func.count(Attempt.id)).where(
                Attempt.status.in_([AttemptStatus.IN_PROGRESS, AttemptStatus.PAUSED])
            )
        ),
        "average_score": round(avg, 2) if avg is not None else None,
        "content": content.content_stats(),
    }


@router.post("/content/questions", status_code=status.HTTP_201_CREATED)
def import_questions(payload: dict = Body(...)) -> dict:
    """Append a validated batch of questions to the bank.

    The batch is validated in full before anything is written, then persisted as
    a new file under ``content/questions/`` so it lands in version control like
    every other content change. Existing ids are rejected rather than silently
    replaced.

    Note: growing the bank rebalances how *future* practice sets are composed.
    Attempts already created are unaffected — each attempt freezes its own
    question order on the row, so a paused attempt always resumes with the
    identical paper.
    """
    items = payload.get("questions")
    name = str(payload.get("name", "")).strip() or f"import-{int(datetime.now().timestamp())}"
    if not isinstance(items, list) or not items:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Body needs a non-empty 'questions' list"
        )

    safe_name = "".join(c for c in name if c.isalnum() or c in "-_")[:60]
    path = CONTENT_DIR / "questions" / f"{safe_name}.json"
    if path.exists():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=f"{path.name} already exists"
        )

    existing = set(content.get_questions())
    for raw in items:
        try:
            content._validate(raw, path)
        except content.ContentError as exc:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
        if raw["id"] in existing:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Question id {raw['id']} already exists in the bank",
            )

    path.write_text(json.dumps({"questions": items}, indent=2) + "\n", encoding="utf-8")
    content.clear_content_caches()

    return {"imported": len(items), "file": path.name, "bank": content.content_stats()}


_TEMPLATE_QUESTION = {
    "id": "AAO-999",
    "domain": "AAO",
    "difficulty": "applied",
    "type": "single",
    "objective": "short label for what this tests",
    "stem": "The question text goes here.",
    "options": [
        {"key": "A", "text": "First option"},
        {"key": "B", "text": "Second option"},
        {"key": "C", "text": "Third option"},
        {"key": "D", "text": "Fourth option"},
    ],
    "correct": ["A"],
    "explanation": "Why the correct option is correct.",
    "distractor_notes": {"B": "Why B is wrong.", "C": "Why C is wrong.", "D": "Why D is wrong."},
    "analogy": {"frame": "SDLC", "text": "Optional real-world analogy."},
    "snippet": None,
    "cheatsheet": "d3-agentic#subagents",
    "sources": [],
    "tags": [],
}


@router.get("/content/questions/template")
def question_template() -> dict:
    """A worked example admins can copy, edit and paste back through import/edit.

    Domain must be one of AAO/TDM/CCW/PES/CMR. For a multi-select question,
    set "type": "multi" and add "select_count": <n> matching len(correct).
    Every wrong option needs an entry in distractor_notes for a single-select
    question — the same rule the content test suite enforces on authored
    content, so a template that violates it would just bounce back at import.
    """
    return {"template": _TEMPLATE_QUESTION}


@router.get("/content/questions")
def list_all_questions(
    domain: str | None = None,
    search: str | None = None,
    page: int = 1,
    per_page: int = 25,
) -> dict:
    """Paginated, searchable index for the admin browse/edit table.

    Deliberately returns the full reveal() payload per item — unlike the
    candidate-facing endpoints, an admin reviewing content for correctness
    needs to see the answer key and explanation right away, not behind an
    extra click per row.
    """
    pool = list(content.get_questions().values())
    if domain:
        pool = [q for q in pool if q.domain == domain.upper()]
    if search:
        needle = search.lower()
        pool = [q for q in pool if needle in q.id.lower() or needle in q.stem.lower()]
    pool.sort(key=lambda q: q.id)

    total = len(pool)
    per_page = max(1, min(per_page, 100))
    pages = max(1, -(-total // per_page))
    page = min(max(page, 1), pages)
    start = (page - 1) * per_page
    page_items = pool[start : start + per_page]

    file_index = {
        item_id: path.name
        for path in sorted(content.QUESTIONS_DIR.glob("*.json"))
        for item_id in (
            entry["id"]
            for entry in (
                lambda payload: payload["questions"] if isinstance(payload, dict) else payload
            )(json.loads(path.read_text(encoding="utf-8")))
        )
    }

    return {
        "page": page,
        "pages": pages,
        "per_page": per_page,
        "total": total,
        "items": [{**q.reveal(), "source_file": file_index.get(q.id)} for q in page_items],
    }


@router.get("/content/questions/{question_id}")
def get_question_detail(question_id: str) -> dict:
    question = content.get_questions().get(question_id)
    if question is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No such question")
    path = content.find_question_file(question_id)
    return {**question.reveal(), "source_file": path.name if path else None}


@router.put("/content/questions/{question_id}")
def update_question(question_id: str, payload: dict = Body(...)) -> dict:
    """Replace one question's fields in place, validated the same way import is.

    This is the "continuous improvement" path: an admin corrects an answer key,
    tightens an explanation, or re-points a stale cheat-sheet anchor, based on
    real feedback — without touching the file on disk directly.
    """
    if payload.get("id") != question_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The 'id' field in the body must match the URL — a PUT cannot rename a question.",
        )
    path = content.find_question_file(question_id)
    if path is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No such question")

    try:
        content._validate(payload, path)
    except content.ContentError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc

    data = json.loads(path.read_text(encoding="utf-8"))
    for i, existing in enumerate(data["questions"]):
        if existing["id"] == question_id:
            data["questions"][i] = payload
            break
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    content.clear_content_caches()

    return {"updated": question_id, "file": path.name}


@router.delete("/content/questions/{question_id}", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
def delete_question(question_id: str) -> None:
    path = content.find_question_file(question_id)
    if path is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No such question")

    data = json.loads(path.read_text(encoding="utf-8"))
    data["questions"] = [q for q in data["questions"] if q["id"] != question_id]
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    content.clear_content_caches()


@router.post("/content/mark-reviewed")
def mark_content_reviewed(
    verified_by: str = Body(embed=True),
    version: str | None = Body(default=None, embed=True),
    admin: Profile = Depends(require_admin),
) -> dict:
    """Record that an admin manually checked the blueprint against Anthropic's page.

    There is no live connection to fetch — the certification page is
    login-gated and there's no public API for it, and even if there were,
    silently auto-rewriting exam content is exactly the kind of unattended
    change this app refuses to make on its own (see ``freshness.note`` on the
    blueprint itself). This is the deliberate, human-in-the-loop alternative:
    a dated, attributed record that someone actually looked, plus an optional
    version bump if the source changed enough to warrant one.
    """
    path = CONTENT_DIR / "blueprint.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    data["freshness"]["last_verified"] = datetime.now(timezone.utc).date().isoformat()
    data["freshness"]["verified_by"] = verified_by.strip()[:200] or "admin"
    if version:
        data["version"] = version.strip()[:40]
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    content.get_blueprint.cache_clear()
    return data["freshness"] | {"version": data["version"]}


@router.post("/updates/refresh")
def refresh_updates() -> dict:
    """Bypass the TTL cache and re-fetch Anthropic's latest videos right now."""
    return updates_service.get_latest_videos(force=True)

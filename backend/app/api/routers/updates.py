"""Anthropic/Claude release videos — a read-only feed pulled from YouTube."""
from __future__ import annotations

from fastapi import APIRouter, Depends

from app.api.deps import get_current_user
from app.models import User
from app.services import updates as updates_service

router = APIRouter(tags=["updates"])


@router.get("/updates/videos")
def latest_videos(_: User = Depends(get_current_user)) -> dict:
    """Registered-user content, gated the same way as cheat sheets and Exam Instincts."""
    return updates_service.get_latest_videos()

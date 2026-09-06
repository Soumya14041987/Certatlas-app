"""Anthropic/Claude release videos, pulled from YouTube's Data API.

There's no scheduler in this app, so "refresh when Anthropic publishes
something new" means: cache the last fetch for ``updates_cache_ttl_minutes``,
and the first request past that window pays for one real API call, which
every concurrent caller shares. This is a nice-to-have feed alongside the
exam content, never a dependency of it, so any failure degrades to an empty
or stale list rather than a 500.
"""
from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timezone

import httpx

from app.core.config import settings

logger = logging.getLogger("ccarf.updates")

_YOUTUBE_API = "https://www.googleapis.com/youtube/v3"

_lock = threading.Lock()
_channel_id: str | None = None
_cache: dict | None = None
_cache_at = 0.0


@dataclass
class VideoItem:
    video_id: str
    title: str
    description: str
    published_at: str
    thumbnail_url: str
    channel_title: str

    def as_dict(self) -> dict:
        return {
            "video_id": self.video_id,
            "title": self.title,
            "description": self.description,
            "published_at": self.published_at,
            "thumbnail_url": self.thumbnail_url,
            "channel_title": self.channel_title,
            "url": f"https://www.youtube.com/watch?v={self.video_id}",
        }


def _source_url() -> str:
    return f"https://www.youtube.com/{settings.youtube_channel_handle}"


def _resolve_channel_id(client: httpx.Client) -> str:
    global _channel_id
    if _channel_id:
        return _channel_id
    response = client.get(
        f"{_YOUTUBE_API}/channels",
        params={
            "part": "id",
            "forHandle": settings.youtube_channel_handle.lstrip("@"),
            "key": settings.youtube_api_key,
        },
    )
    response.raise_for_status()
    items = response.json().get("items") or []
    if not items:
        raise RuntimeError(f"No YouTube channel found for {settings.youtube_channel_handle}")
    _channel_id = items[0]["id"]
    return _channel_id


def _fetch_videos() -> list[VideoItem]:
    with httpx.Client(timeout=10) as client:
        channel_id = _resolve_channel_id(client)
        response = client.get(
            f"{_YOUTUBE_API}/search",
            params={
                "part": "snippet",
                "channelId": channel_id,
                "order": "date",
                "type": "video",
                "maxResults": settings.updates_max_results,
                "key": settings.youtube_api_key,
            },
        )
        response.raise_for_status()
        raw_items = response.json().get("items", [])

    videos = []
    for item in raw_items:
        video_id = item.get("id", {}).get("videoId")
        if not video_id:
            continue
        snippet = item.get("snippet", {})
        thumbnails = snippet.get("thumbnails", {})
        thumb = thumbnails.get("high") or thumbnails.get("medium") or thumbnails.get("default") or {}
        videos.append(
            VideoItem(
                video_id=video_id,
                title=snippet.get("title", ""),
                description=snippet.get("description", ""),
                published_at=snippet.get("publishedAt", ""),
                thumbnail_url=thumb.get("url", ""),
                channel_title=snippet.get("channelTitle", ""),
            )
        )
    return videos


def get_latest_videos(force: bool = False) -> dict:
    if not settings.youtube_api_key:
        return {"configured": False, "videos": [], "fetched_at": None, "source": _source_url()}

    global _cache, _cache_at
    ttl_seconds = settings.updates_cache_ttl_minutes * 60
    now = time.time()

    with _lock:
        if not force and _cache is not None and (now - _cache_at) < ttl_seconds:
            return _cache
        try:
            videos = _fetch_videos()
            _cache = {
                "configured": True,
                "videos": [v.as_dict() for v in videos],
                "fetched_at": datetime.now(timezone.utc).isoformat(),
                "source": _source_url(),
            }
        except (httpx.HTTPError, RuntimeError) as exc:
            logger.warning("YouTube updates refresh failed: %s", exc)
            if _cache is not None:
                return _cache
            _cache = {
                "configured": True,
                "videos": [],
                "fetched_at": None,
                "source": _source_url(),
                "error": "Could not reach YouTube right now",
            }
        _cache_at = now
        return _cache


def clear_cache() -> None:
    """Test hook: forces the next call to hit the network again."""
    global _cache, _cache_at, _channel_id
    with _lock:
        _cache = None
        _cache_at = 0.0
        _channel_id = None

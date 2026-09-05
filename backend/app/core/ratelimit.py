"""In-process fixed-window rate limiter.

Deliberately dependency-free. It is correct for a single uvicorn worker, which
is what the bundled docker-compose runs. Behind multiple workers or replicas,
swap ``_HITS`` for a Redis INCR+EXPIRE — the ``RateLimiter`` interface does not
change.
"""
# NOTE: no `from __future__ import annotations` here on purpose. RateLimiter is
# used as a FastAPI dependency *instance*, and instances carry no __globals__ for
# FastAPI to resolve stringified annotations against — Request would silently be
# treated as a query parameter.

import threading
import time
from collections import defaultdict

from fastapi import HTTPException, Request, status

from app.core.config import settings

_LOCK = threading.Lock()
_HITS: dict[tuple[str, str, int], int] = defaultdict(int)
_LAST_SWEEP = 0.0


def _client_key(request: Request) -> str:
    # X-Forwarded-For is only trusted when a proxy is explicitly in front; the
    # first hop is used because that is the address the proxy observed.
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _sweep(window: int) -> None:
    global _LAST_SWEEP
    now = time.time()
    if now - _LAST_SWEEP < 60:
        return
    _LAST_SWEEP = now
    stale = [k for k in _HITS if k[2] < window - 1]
    for key in stale:
        _HITS.pop(key, None)


class RateLimiter:
    """FastAPI dependency: ``Depends(RateLimiter(bucket="auth", per_minute=10))``."""

    def __init__(self, bucket: str, per_minute: int | None = None) -> None:
        self.bucket = bucket
        self.per_minute = per_minute or settings.rate_limit_default_per_minute

    def __call__(self, request: Request) -> None:
        if not settings.rate_limit_enabled:
            return
        window = int(time.time() // 60)
        key = (_client_key(request), self.bucket, window)
        with _LOCK:
            _sweep(window)
            _HITS[key] += 1
            count = _HITS[key]
        if count > self.per_minute:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Rate limit exceeded. Slow down and try again shortly.",
                headers={"Retry-After": str(60 - int(time.time() % 60))},
            )


auth_rate_limit = RateLimiter("auth", settings.rate_limit_auth_per_minute)
api_rate_limit = RateLimiter("api", settings.rate_limit_default_per_minute)


def reset() -> None:
    """Test helper: drop all counters."""
    with _LOCK:
        _HITS.clear()

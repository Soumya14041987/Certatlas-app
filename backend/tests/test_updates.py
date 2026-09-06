"""Anthropic/Claude release-video feed: auth gating, caching, admin refresh."""
from tests.conftest import register

from app.core.config import settings
from app.services import updates as updates_service


def _fake_fetch() -> list[updates_service.VideoItem]:
    return [
        updates_service.VideoItem(
            video_id="abc123",
            title="Claude 5 launch",
            description="What's new in Claude 5.",
            published_at="2026-01-01T00:00:00Z",
            thumbnail_url="https://example.com/thumb.jpg",
            channel_title="Anthropic",
        )
    ]


def teardown_function(_):
    updates_service.clear_cache()


def test_videos_require_authentication(client):
    assert client.get("/api/v1/updates/videos").status_code == 401


def test_feed_is_unconfigured_without_an_api_key(client, auth, monkeypatch):
    monkeypatch.setattr(settings, "youtube_api_key", None)
    body = client.get("/api/v1/updates/videos", headers=auth).json()
    assert body == {
        "configured": False,
        "videos": [],
        "fetched_at": None,
        "source": "https://www.youtube.com/@anthropic-ai",
    }


def test_feed_returns_videos_once_configured(client, auth, monkeypatch):
    monkeypatch.setattr(settings, "youtube_api_key", "test-key")
    monkeypatch.setattr(updates_service, "_fetch_videos", _fake_fetch)
    updates_service.clear_cache()

    body = client.get("/api/v1/updates/videos", headers=auth).json()
    assert body["configured"] is True
    assert body["videos"][0]["video_id"] == "abc123"
    assert body["videos"][0]["url"] == "https://www.youtube.com/watch?v=abc123"


def test_feed_is_cached_within_the_ttl(client, auth, monkeypatch):
    calls = {"n": 0}

    def counting_fetch():
        calls["n"] += 1
        return _fake_fetch()

    monkeypatch.setattr(settings, "youtube_api_key", "test-key")
    monkeypatch.setattr(updates_service, "_fetch_videos", counting_fetch)
    updates_service.clear_cache()

    client.get("/api/v1/updates/videos", headers=auth)
    client.get("/api/v1/updates/videos", headers=auth)
    assert calls["n"] == 1


def test_admin_refresh_bypasses_the_cache(client, auth, monkeypatch):
    calls = {"n": 0}

    def counting_fetch():
        calls["n"] += 1
        return _fake_fetch()

    monkeypatch.setattr(settings, "youtube_api_key", "test-key")
    monkeypatch.setattr(updates_service, "_fetch_videos", counting_fetch)
    updates_service.clear_cache()

    client.get("/api/v1/updates/videos", headers=auth)
    response = client.post("/api/v1/admin/updates/refresh", headers=auth)
    assert response.status_code == 200
    assert calls["n"] == 2


def test_admin_refresh_requires_admin_role(client, auth):
    other = register(client, "plain-updates@example.com")
    plain = {"Authorization": f"Bearer {other['access_token']}"}
    assert client.post("/api/v1/admin/updates/refresh", headers=plain).status_code == 403

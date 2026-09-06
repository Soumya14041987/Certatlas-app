"""Sign-in-with-provider start route.

These credentials are unset in every test run (no CCARF_GOOGLE_CLIENT_ID /
CCARF_GITHUB_CLIENT_ID in the environment), so both providers exercise the
"not configured" path. The regression this guards: that path must redirect
back into the app with a query param the login page reads and displays --
not raise a raw HTTPException, which would render as a bare JSON page for a
real browser doing the top-level navigation the sign-in button requires.
"""
from urllib.parse import unquote_plus


def test_google_start_without_credentials_redirects_to_login(client):
    response = client.get(
        "/api/v1/auth/oauth/google/start", follow_redirects=False
    )
    assert response.status_code == 302
    location = response.headers["location"]
    assert location.startswith("http://localhost:5173/login?oauth_error=")
    assert "Google is not configured" in unquote_plus(location)


def test_github_start_without_credentials_redirects_to_login(client):
    response = client.get(
        "/api/v1/auth/oauth/github/start", follow_redirects=False
    )
    assert response.status_code == 302
    location = response.headers["location"]
    assert location.startswith("http://localhost:5173/login?oauth_error=")
    assert "Github is not configured" in unquote_plus(location)


def test_unknown_provider_is_a_client_error_not_a_redirect(client):
    response = client.get("/api/v1/auth/oauth/mastodon/start", follow_redirects=False)
    assert response.status_code == 404

# CertAtlas

An exam-preparation web application, currently covering **Claude Certified Architect – Foundations (CCAF)**, built as a Python (FastAPI) backend with a React/TypeScript frontend.

> **Not affiliated with, endorsed by, or sourced from Anthropic.** Domain names, weightings and the scoring format are taken from Anthropic's own public certification listing so the practice material rehearses the real structure of the exam. Every question, explanation, analogy, code snippet and cheat sheet in this repository is **original, community-authored practice content** — none of it is a real exam item.

## What it does

- **Practice mode** — 300 blueprint-weighted sets of 60 questions each. Untimed, pausable (the clock stops and your paper freezes exactly as you left it), with a published scorecard on every submission.
- **Exam mode** — a single 60-question, 90-minute mock sitting, enforced server-side, no pausing — a faithful rehearsal of the real conditions.
- **Wrong-answer review** — every miss comes back with the explanation, a note on why each distractor is wrong, a real-world analogy (SDLC, AWS CodePipeline, IAM, Kubernetes, etc.), a working code snippet, and the exact cheat-sheet section — inlined, so there's nothing to go looking for.
- **Readiness analytics** — per-domain accuracy weighted by the blueprint, a projected score, and a focus-area list.
- **What's New** — Anthropic's latest release/engineering videos, pulled from their YouTube channel (see below). Not exam content — a side feed for keeping up while you study.
- Full auth: registration, login, JWT access + rotating refresh tokens, session listing/revocation, sign in with Google/GitHub, and role-based access control (admin console, content import).

## Exam blueprint

| Domain | Weight | Questions |
|---|---|---|
| Agentic Architecture & Orchestration | 27% | 16 |
| Tool Design & MCP Integration | 18% | 11 |
| Claude Code Configuration & Workflows | 20% | 12 |
| Prompt Engineering & Structured Output | 20% | 12 |
| Context Management & Reliability | 15% | 9 |

Scored on Anthropic's 100–1000 scale; 720 (this app's internal 72%) is passing.

## Stack

- **Backend:** FastAPI, SQLAlchemy 2.0, Pydantic v2, PyJWT, bcrypt, SQLite (swap `CCARF_DATABASE_URL` for Postgres in production).
- **Frontend:** React 18, TypeScript, React Router, Tailwind CSS v4, Vite.
- **Content:** JSON/Markdown under `backend/app/content/` — reviewable and versioned like code. No LLM calls at runtime; the app serves pre-authored questions and cheat sheets.

## Running locally

### Backend

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
cp .env.example .env   # edit as needed
python -m app.seed     # creates tables, validates the content bank
uvicorn app.main:app --reload --port 8000
```

API docs at `http://127.0.0.1:8000/docs` (development only).

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Open `http://127.0.0.1:5173`. Vite proxies `/api` to `http://127.0.0.1:8000` in development, so no CORS configuration is needed locally.

### Tests

```bash
cd backend && pytest -q       # 39 tests: auth, attempts, scoring, content integrity
cd frontend && npm run typecheck && npm run build
```

## Running with Docker

```bash
export CCARF_SECRET_KEY=$(python3 -c "import secrets; print(secrets.token_urlsafe(64))")
docker compose up --build
```

The API is on `:8000`, the built frontend on `:5173` (served by nginx). Set `CCARF_FIRST_ADMIN_EMAIL` / `CCARF_FIRST_ADMIN_PASSWORD` to bootstrap an admin account, or just register the first account through the UI — it becomes the administrator automatically.

## OAuth sign-in (Google / GitHub)

The login page always shows "Continue with Google" and "Continue with GitHub".
Each one only works once its credentials are set — until then the backend
returns a clear "not configured" error instead of crashing.

1. **Google** — [Google Cloud Console](https://console.cloud.google.com/apis/credentials) →
   Create OAuth client ID → Web application. Authorized redirect URI:
   `{CCARF_PUBLIC_BASE_URL}/api/v1/auth/oauth/google/callback`.
2. **GitHub** — [github.com/settings/developers](https://github.com/settings/developers) →
   New OAuth App. Authorization callback URL:
   `{CCARF_PUBLIC_BASE_URL}/api/v1/auth/oauth/github/callback`.
3. Put the resulting client ID/secret pairs, plus `CCARF_PUBLIC_BASE_URL`
   (where the backend itself is reachable) and `CCARF_FRONTEND_BASE_URL`
   (where the browser should land afterwards), in `backend/.env` — see
   `backend/.env.example`. Locally the defaults
   (`http://127.0.0.1:8000` / `http://localhost:5173`) already match.

Signing in links or creates a `User` by verified email; an account created
this way has no password (`hashed_password` is null) unless one is set later.
There's no Alembic migration in this project (see `app/db/session.py`), so an
existing local `ccarf.db` predating these two columns needs to be deleted and
recreated with `python -m app.seed`.

## What's New feed (Anthropic YouTube videos)

The "What's New" page shows Anthropic's most recent videos — release
announcements, engineering talks, livestreams — pulled from their official
YouTube channel via the **YouTube Data API v3** (there's no separate
"Anthropic video API"; YouTube's is the actual public surface for this).

1. Get an API key with the YouTube Data API v3 enabled: [Google Cloud
   Console → Credentials](https://console.cloud.google.com/apis/credentials).
2. Set `CCARF_YOUTUBE_API_KEY` in `backend/.env`. `CCARF_YOUTUBE_CHANNEL_HANDLE`
   defaults to `@anthropic-ai` and rarely needs changing.
3. The page is hidden behind a clear "not set up yet" message until the key
   is present — nothing breaks if you skip this.

There's no scheduler in this app (no cron, no Celery), so "refresh when
Anthropic posts something new" is done lazily: the backend caches the last
fetch for `CCARF_UPDATES_CACHE_TTL_MINUTES` (default 6 hours), and the first
request past that window pays for one real API call on everyone's behalf.
An admin can also force an immediate re-fetch from the page itself, which
calls `POST /api/v1/admin/updates/refresh`.

## Security notes

- Passwords are bcrypt-hashed (SHA-256 pre-hashed first, so long passwords aren't silently truncated at bcrypt's 72-byte limit).
- Access tokens are short-lived JWTs; refresh tokens are rotated on every use and individually revocable (`/auth/sessions`, `/auth/logout-all`).
- All attempt/scorecard/review endpoints are scoped to the authenticated user; cross-account access returns 404, not 403, so attempt IDs aren't enumerable.
- Admin endpoints require the `admin` role, re-checked against the database on every request (not just trusted from the JWT claim).
- Security headers (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, HSTS in production) are set on every response.
- A simple in-process rate limiter guards auth endpoints; swap for Redis-backed limiting behind multiple workers.

## Content authoring

Questions live in `backend/app/content/questions/*.json`; cheat sheets in `backend/app/content/cheatsheets/*.md`. The bank is validated on startup (`app/seed.py`, `app/services/content.py`) — a malformed question, an unresolved cheat-sheet reference, or a mismatched answer-key length fails fast rather than serving broken content. Admins can append a validated batch via `POST /api/v1/admin/content/questions`.

## License

MIT — see [LICENSE](LICENSE).

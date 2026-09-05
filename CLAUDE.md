# CCAR-F Exam Prep

Exam-prep web app for Claude Certified Architect – Foundations. FastAPI backend
(SQLite/SQLAlchemy, JWT auth) + React/TS/Tailwind frontend. Full setup and
Docker instructions are in @README.md — this file is for working *on* the
codebase, not running it.

## Commands

```bash
# Backend (run from backend/)
source .venv/bin/activate
pytest -q                    # 40 tests — must pass before any backend change is done
ruff check .                 # must be clean
python -m app.seed           # recreates tables, validates the full content bank, checks
                              # set determinism — run this after ANY content edit

# Frontend (run from frontend/)
npx tsc --noEmit              # must pass
npm run build                 # must succeed
npm run dev                   # http://127.0.0.1:5173, proxies /api to :8000
```

CI (`.github/workflows/ci.yml`) runs all four gates on every push/PR. Don't
consider a change finished until they pass locally.

## Hard rules

- **The five real exam domains are `AAO`, `TDM`, `CCW`, `PES`, `CMR`** (see
  `backend/app/content/blueprint.json`). Never reintroduce the old `D1`–`D7`
  codes anywhere — they were the pre-correction, invented taxonomy and no
  longer mean anything in this codebase.
- **Question filenames are historical, not authoritative.** Files under
  `backend/app/content/questions/` are still named `d1_fundamentals_a.json`
  etc. from the original authoring batches, but each question's real domain
  is its own `"domain"` field (`AAO`/`TDM`/`CCW`/`PES`/`CMR`), independent of
  which file it lives in. Don't infer a question's domain from its filename
  or its `id` prefix (`D3-012` is domain `AAO`, not "D3").
- **Cheat-sheet slugs and exam domains are two different taxonomies.**
  There are 7 cheat sheets (`d1-fundamentals` … `d7-prompting`) but only 5
  exam domains. `d5-automation` and `d6-security` are supplementary
  references with no primary domain of their own — a question's
  `"cheatsheet": "slug#anchor"` field can point at any of the 7 sheets
  regardless of that question's own domain. Never force a question's
  cheatsheet slug to match its domain; that already caused one bug (see the
  domain-remap postmortem below) and broke correct section references.
- **Practice sets must stay deterministic.** `app/services/set_builder.py`
  seeds its RNG from `SALT + set_number`. Changing `SALT`, the sampling
  algorithm, or the blueprint's domain weights changes what every practice
  set *is* — a user mid-attempt on a paused Set 042 expects the exact same
  60 questions on resume. If you must change the algorithm, bump `SALT` and
  say so in the commit message.
- **Live attempts never leak the answer key.** `Question.public()` (no
  `correct`/`explanation`/`distractor_notes`) is what attempts/runner
  endpoints return; `Question.reveal()` (everything) is only reachable after
  submission, via `/attempts/{id}/review` or the admin/bookmark question
  lookup. If you add a new attempt-facing endpoint, use `public()`.
- **Content is validated at startup, not best-effort.** `app/services/content.py`
  (`_validate`, `get_heuristics`) raises `ContentError` on a malformed
  question, an unresolved cheat-sheet reference, or a heuristics domain code
  that isn't real. A bad content edit should fail `python -m app.seed`
  immediately — don't relax these checks to get a red run to pass.
- **First registered user becomes admin.** No seeded default account exists
  unless `CCARF_FIRST_ADMIN_EMAIL`/`_PASSWORD` are set (see
  `app/seed.py`). Don't add a hardcoded admin credential anywhere.

## Adding content

New questions: add to an existing `questions/*.json` file or a new one (any
filename — they're all globbed) with a globally unique `id`. Required per
question: `id`, `domain` (one of the 5 real codes), `difficulty`
(`foundational`/`applied`/`architect`), `type` (`single`/`multi`), `stem`,
`options`, `correct`, `explanation`. For `type: "single"`, every wrong option
needs an entry in `distractor_notes` — `_validate` doesn't enforce this but
`tests/test_content.py::test_every_question_is_internally_consistent` does.
Run `python -m app.seed` after any edit; it validates the whole bank and
re-verifies set determinism (both cheap, both catch mistakes immediately).

New cheat-sheet sections: `## anchor-name` headings in the relevant
`cheatsheets/*.md` file. A question references one with
`"cheatsheet": "slug#anchor-name"`; `resolve_cheatsheet` in `content.py`
splits on `#`. `tests/test_content.py::test_every_cheatsheet_reference_resolves`
fails loudly if the slug or anchor doesn't exist — trust it over manual
proofreading, it caught a real bug once (see below).

New heuristics ("Exam Instincts", `content/heuristics.json`): `universal` is a
flat list, `domains` is keyed by the 5 real domain codes only —
`get_heuristics()` raises if a key isn't a real blueprint domain.

## Known history worth knowing

The exam blueprint was originally invented (7 domains, D1–D7) before the real
Anthropic certification page was checked against it. It was corrected to the
actual 5-domain structure — every question's `domain` field was remapped,
but the remap script's first pass *also* rewrote `cheatsheet` fields to match
each question's new domain, which broke ~60 correct section references
(there's no real domain whose primary sheet is `d5-automation` or
`d6-security`, so anything pointing there got redirected to an unrelated
sheet). It was caught by `test_every_cheatsheet_reference_resolves` and fixed
by restoring the original slug#anchor values. The lesson embedded in the
rules above — domain and cheatsheet slug are independent, don't derive one
from the other — is a direct result of that incident.

## Layout

```
backend/app/
  core/         config, security (JWT/bcrypt), rate limiting
  db/           SQLAlchemy engine/session
  models/       User, Attempt, AttemptAnswer, RefreshToken, Bookmark
  schemas/      Pydantic request/response models
  services/     content.py (loader+validator), set_builder.py (deterministic
                sets), scoring.py (grading + scorecard + review payload)
  api/routers/  auth, catalog (blueprint/courses/cheatsheets/heuristics),
                attempts (practice+exam lifecycle), analytics, admin
  content/      blueprint.json, courses.json, heuristics.json,
                questions/*.json, cheatsheets/*.md
  seed.py       creates tables + validates content bank + checks set determinism

frontend/src/
  lib/          api.ts (fetch client + token refresh), auth.tsx (context),
                types.ts, format.ts, highlight.ts (snippet syntax highlight),
                markdown.ts (cheat-sheet rendering)
  components/   Shell (nav), ui.tsx (Card/Meter/CodeBlock/DomainBars/etc.)
  pages/        one per route — Runner.tsx is the timed/pausable question UI,
                Review.tsx is the post-submission teaching view
```

## Style

No inline comments unless they explain a non-obvious constraint (see the ones
already in the codebase for the bar — e.g. why bcrypt input is SHA-256
pre-hashed, why `RateLimiter` avoids `from __future__ import annotations`).
Don't add comments that restate what the code does.

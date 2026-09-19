"""Validate the content bank and confirm practice-set determinism.

    python -m app.seed

Table creation and the bootstrap admin are both gone from this script:
schema lives in ``supabase/migrations/*.sql`` now (owned by the Supabase
CLI, not this app — see ``db/session.init_db``'s SQLite-only guard), and
there is no local "first user becomes admin" trick any more. Promote the
first real account manually after signing up:

    update public.profiles set role = 'admin' where email = '...';

(run in the Supabase project's SQL editor)
"""
from __future__ import annotations

import sys

from app.core.config import settings
from app.db.session import init_db
from app.services.content import ContentError, content_stats
from app.services.set_builder import build_practice_set


def main() -> int:
    print("Creating tables (SQLite fallback only — Postgres schema is Supabase-managed)…")
    init_db()

    print("Validating content bank…")
    try:
        stats = content_stats()
    except ContentError as exc:
        print(f"  content bank is invalid: {exc}", file=sys.stderr)
        return 1
    print(f"  {stats['total_questions']} questions across {len(stats['domains'])} domains")
    for domain in stats["domains"]:
        print(f"    {domain['code']}  {domain['count']:>3}  {domain['name']}")
    print(f"  {stats['cheatsheets']} cheat sheets, {stats['courses']} mapped courses")

    print(f"Verifying {settings.practice_set_count} practice sets are reproducible…")
    for number in (1, settings.practice_set_count // 2, settings.practice_set_count):
        first, second = build_practice_set(number), build_practice_set(number)
        assert first == second, f"Set {number} is not deterministic"
        assert len(first) == settings.practice_set_size
    print("  deterministic ✓")

    print(
        "No bootstrap admin step here any more — sign up once through the app, then "
        "promote that account in the Supabase SQL editor:\n"
        "  update public.profiles set role = 'admin' where email = '...';"
    )
    print("Seed complete.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

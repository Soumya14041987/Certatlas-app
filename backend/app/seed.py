"""Create tables, validate the content bank and optionally bootstrap an admin.

    python -m app.seed

The admin is only created when both CCARF_FIRST_ADMIN_EMAIL and
CCARF_FIRST_ADMIN_PASSWORD are set; there is deliberately no default password.
"""
from __future__ import annotations

import sys
from datetime import datetime, timezone

from sqlalchemy import select

from app.core.config import settings
from app.core.security import hash_password, password_problems
from app.db.session import SessionLocal, init_db
from app.models import User, UserRole
from app.services.content import ContentError, content_stats
from app.services.set_builder import build_practice_set


def main() -> int:
    print("Creating tables…")
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

    email = settings.first_admin_email
    password = settings.first_admin_password
    if email and password:
        problems = password_problems(password)
        if problems:
            print(f"  admin password rejected: needs {', '.join(problems)}", file=sys.stderr)
            return 1
        with SessionLocal() as db:
            if db.scalar(select(User).where(User.email == email.lower())):
                print(f"Admin {email} already exists; leaving it alone.")
            else:
                db.add(
                    User(
                        email=email.lower(),
                        full_name="Platform Administrator",
                        hashed_password=hash_password(password),
                        role=UserRole.ADMIN,
                        created_at=datetime.now(timezone.utc),
                    )
                )
                db.commit()
                print(f"Created admin account {email}")
    else:
        print(
            "No bootstrap admin configured. The first account registered through "
            "/auth/register becomes the administrator."
        )

    print("Seed complete.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

"""Deterministic composition of practice sets and exam papers.

Practice set N is always the same 60 questions in the same order, for every
user, forever: the RNG is seeded from the set number and a version salt. That
matters because a scorecard for "Set 118" has to mean the same thing next month
as it does today, and because a paused attempt must resume with an identical
paper.

Set size (60) exceeds the number of authored items in any single domain, so
sets necessarily overlap — the standard behaviour of every practice platform.
Weighting follows the published blueprint, so each set is a faithful rehearsal
of the real distribution even where individual items repeat across sets.
"""
from __future__ import annotations

import random
from typing import Iterable

from app.core.config import settings
from app.services.content import Question, get_blueprint, questions_by_domain

SALT = "ccarf-2026.1"


def _domain_quota(total: int) -> list[tuple[str, int]]:
    """Split ``total`` questions across domains by blueprint weight.

    Largest-remainder apportionment, so the parts always sum exactly to
    ``total`` regardless of rounding.
    """
    domains = get_blueprint()["domains"]
    exact = [(d["code"], total * d["weight_percent"] / 100) for d in domains]
    quota = {code: int(value) for code, value in exact}
    remainder = total - sum(quota.values())
    for code, value in sorted(exact, key=lambda kv: kv[1] - int(kv[1]), reverse=True):
        if remainder <= 0:
            break
        quota[code] += 1
        remainder -= 1
    return [(d["code"], quota[d["code"]]) for d in domains]


def _sample(pool: list[Question], count: int, rng: random.Random) -> list[Question]:
    """Draw ``count`` items, cycling through reshuffled copies if the pool is small."""
    if count <= len(pool):
        return rng.sample(pool, count)
    picked: list[Question] = []
    while len(picked) < count:
        block = pool[:]
        rng.shuffle(block)
        picked.extend(block[: count - len(picked)])
    return picked


def _compose(seed: str, total: int) -> list[str]:
    rng = random.Random(seed)
    by_domain = questions_by_domain()
    chosen: list[Question] = []
    for code, count in _domain_quota(total):
        pool = by_domain.get(code, [])
        if pool and count:
            chosen.extend(_sample(pool, count, rng))
    rng.shuffle(chosen)
    return [q.id for q in chosen]


def build_practice_set(set_number: int, size: int | None = None) -> list[str]:
    """The frozen question order for practice set ``set_number`` (1-based)."""
    if not 1 <= set_number <= settings.practice_set_count:
        raise ValueError(f"Set number must be 1..{settings.practice_set_count}")
    return _compose(f"{SALT}:practice:{set_number}", size or settings.practice_set_size)


def build_exam_paper(seed: str) -> list[str]:
    """A blueprint-weighted 60-question paper, unique per sitting."""
    return _compose(f"{SALT}:exam:{seed}", settings.exam_question_count)


def practice_set_summary(set_number: int) -> dict:
    """Metadata for the set catalogue, without revealing which questions are in it."""
    from app.services.content import get_question

    ids = build_practice_set(set_number)
    questions = [q for q in (get_question(i) for i in ids) if q]
    difficulty = {"foundational": 0, "applied": 0, "architect": 0}
    domains: dict[str, int] = {}
    for q in questions:
        difficulty[q.difficulty] += 1
        domains[q.domain] = domains.get(q.domain, 0) + 1
    hard = difficulty["architect"] / max(len(questions), 1)
    return {
        "set_number": set_number,
        "size": len(ids),
        "difficulty": difficulty,
        "domains": dict(sorted(domains.items())),
        "intensity": "high" if hard >= 0.26 else "moderate" if hard >= 0.16 else "steady",
    }


def catalogue(page: int = 1, per_page: int = 30) -> dict:
    total = settings.practice_set_count
    pages = max(1, -(-total // per_page))
    page = min(max(page, 1), pages)
    start = (page - 1) * per_page + 1
    numbers: Iterable[int] = range(start, min(start + per_page, total + 1))
    return {
        "page": page,
        "pages": pages,
        "per_page": per_page,
        "total": total,
        "sets": [practice_set_summary(n) for n in numbers],
    }

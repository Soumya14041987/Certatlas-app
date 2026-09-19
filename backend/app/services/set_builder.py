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
from app.services.content import Question, get_blueprint, get_questions, questions_by_domain

SALT = "ccarf-2026.1"


def _apportion(weights: dict[str, float], total: int) -> list[tuple[str, int]]:
    """Largest-remainder apportionment of ``total`` across ``weights`` (percentages).

    Guarantees the parts sum exactly to ``total`` regardless of rounding, for
    any weight map — the blueprint's own weights, or a caller-adjusted one
    (see ``build_focus_set``).
    """
    exact = {code: total * w / 100 for code, w in weights.items()}
    quota = {code: int(value) for code, value in exact.items()}
    remainder = total - sum(quota.values())
    for code in sorted(exact, key=lambda c: exact[c] - quota[c], reverse=True):
        if remainder <= 0:
            break
        quota[code] += 1
        remainder -= 1
    return [(code, quota[code]) for code in weights]


def _domain_quota(total: int) -> list[tuple[str, int]]:
    """Split ``total`` questions across domains by blueprint weight."""
    weights = {d["code"]: d["weight_percent"] for d in get_blueprint()["domains"]}
    return _apportion(weights, total)


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


def _compose_from_quota(seed: str, quota: list[tuple[str, int]]) -> list[str]:
    rng = random.Random(seed)
    by_domain = questions_by_domain()
    chosen: list[Question] = []
    for code, count in quota:
        pool = by_domain.get(code, [])
        if pool and count:
            chosen.extend(_sample(pool, count, rng))
    rng.shuffle(chosen)
    return [q.id for q in chosen]


def _compose(seed: str, total: int) -> list[str]:
    return _compose_from_quota(seed, _domain_quota(total))


def build_practice_set(set_number: int, size: int | None = None) -> list[str]:
    """The frozen question order for practice set ``set_number`` (1-based)."""
    if not 1 <= set_number <= settings.practice_set_count:
        raise ValueError(f"Set number must be 1..{settings.practice_set_count}")
    return _compose(f"{SALT}:practice:{set_number}", size or settings.practice_set_size)


def build_exam_paper(seed: str) -> list[str]:
    """A blueprint-weighted 60-question paper, unique per sitting."""
    return _compose(f"{SALT}:exam:{seed}", settings.exam_question_count)


def build_quick_mock(seed: str) -> list[str]:
    """Random scenarios plus every question tied to them, interleaved, like the real exam's scenario sets."""
    rng = random.Random(f"{SALT}:quick:{seed}")
    by_scenario: dict[str, list[str]] = {}
    for q in get_questions().values():
        if q.scenario:
            by_scenario.setdefault(q.scenario, []).append(q.id)
    chosen = rng.sample(sorted(by_scenario), min(settings.quick_mock_scenarios, len(by_scenario)))
    ids = sorted(i for s in chosen for i in by_scenario[s])
    rng.shuffle(ids)
    return ids


def build_diagnostic_paper(seed: str) -> list[str]:
    """A short, blueprint-weighted readiness check — freshly composed per sitting."""
    return _compose(f"{SALT}:diagnostic:{seed}", settings.diagnostic_question_count)


# Focus-set weighting: how much a domain's share is boosted below the pass mark.
# A domain sitting exactly at the pass mark gets no boost; one at 0% (or never
# attempted) gets the full FOCUS_BOOST_CAP on top of its blueprint weight.
FOCUS_BOOST_CAP = 1.2
FOCUS_MIN_SHARE_PERCENT = 5.0


def _focus_weights(domain_accuracy: dict[str, float | None]) -> dict[str, float]:
    """Blueprint weights, boosted toward domains the candidate is weak in.

    ``domain_accuracy`` maps a domain code to a 0-100 accuracy figure, or
    ``None`` if the candidate has never been scored on it (treated as
    maximum-risk, same as a 0% domain — untested is not the same as strong).
    Weights are boosted, renormalised to sum to 100, then floored so no
    domain — however strong — drops out of the set entirely.
    """
    pass_mark = settings.exam_pass_percent
    boosted: dict[str, float] = {}
    for domain in get_blueprint()["domains"]:
        code, base = domain["code"], domain["weight_percent"]
        percent = domain_accuracy.get(code)
        if percent is None:
            boost = FOCUS_BOOST_CAP
        else:
            shortfall = max(0.0, (pass_mark - percent) / pass_mark)
            boost = FOCUS_BOOST_CAP * min(shortfall, 1.0)
        boosted[code] = base * (1 + boost)

    total = sum(boosted.values())
    normalised = {code: w / total * 100 for code, w in boosted.items()}
    floored = {code: max(w, FOCUS_MIN_SHARE_PERCENT) for code, w in normalised.items()}
    floored_total = sum(floored.values())
    return {code: w / floored_total * 100 for code, w in floored.items()}


def build_focus_set(
    domain_accuracy: dict[str, float | None], seed: str, size: int | None = None
) -> list[str]:
    """A personalised set skewed toward the candidate's weaker domains.

    Still covers every domain (floored at ``FOCUS_MIN_SHARE_PERCENT``) — this
    is a rehearsal weighted by need, not a drill that abandons what's already
    strong. Freshly composed each time, not a numbered catalogue entry.
    """
    quota = _apportion(_focus_weights(domain_accuracy), size or settings.practice_set_size)
    return _compose_from_quota(f"{SALT}:focus:{seed}", quota)


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

import pytest

from app.services.content import get_blueprint, get_cheatsheets, get_heuristics, get_questions, resolve_cheatsheet
from app.services.set_builder import _domain_quota, build_practice_set, catalogue


def test_blueprint_weights_and_counts_are_coherent():
    blueprint = get_blueprint()
    assert sum(d["weight_percent"] for d in blueprint["domains"]) == 100
    assert sum(d["exam_questions"] for d in blueprint["domains"]) == blueprint["question_count"]


def test_every_question_is_internally_consistent():
    for q in get_questions().values():
        keys = {o["key"] for o in q.options}
        assert set(q.correct) <= keys, q.id
        assert len(q.correct) == q.select_count, q.id
        assert q.explanation.strip(), q.id
        # Every wrong option should carry a note explaining why it is wrong.
        for wrong in keys - set(q.correct):
            assert wrong in q.distractor_notes or q.type == "multi", f"{q.id} option {wrong}"


def test_every_cheatsheet_reference_resolves():
    for q in get_questions().values():
        if not q.cheatsheet:
            continue
        resolved = resolve_cheatsheet(q.cheatsheet)
        assert resolved is not None, f"{q.id} -> {q.cheatsheet}"
        anchor = resolved.get("anchor")
        if anchor:
            assert resolved.get("section"), f"{q.id} -> missing section {q.cheatsheet}"


def test_every_domain_has_a_cheatsheet():
    slugs = set(get_cheatsheets())
    for domain in get_blueprint()["domains"]:
        assert domain["cheatsheet"] in slugs


def test_domain_quota_sums_to_the_paper_size():
    for size in (30, 60, 61, 100):
        assert sum(count for _, count in _domain_quota(size)) == size


def test_practice_sets_are_deterministic_and_distinct():
    assert build_practice_set(1) == build_practice_set(1)
    assert build_practice_set(1) != build_practice_set(2)
    paper = build_practice_set(42)
    assert len(paper) == 60
    assert len(set(paper)) == 60, "a set must not repeat a question within itself"


def test_practice_sets_follow_the_blueprint_distribution():
    from app.services.content import get_question

    counts: dict[str, int] = {}
    for qid in build_practice_set(11):
        counts[get_question(qid).domain] = counts.get(get_question(qid).domain, 0) + 1
    assert counts == {code: n for code, n in _domain_quota(60)}


def test_set_number_out_of_range_is_rejected():
    with pytest.raises(ValueError):
        build_practice_set(0)
    with pytest.raises(ValueError):
        build_practice_set(301)


def test_catalogue_pagination_covers_all_sets():
    first = catalogue(page=1, per_page=30)
    assert first["total"] == 300
    assert first["pages"] == 10
    assert first["sets"][0]["set_number"] == 1
    last = catalogue(page=10, per_page=30)
    assert last["sets"][-1]["set_number"] == 300


def test_heuristics_reference_only_real_domain_codes():
    heuristics = get_heuristics()
    valid = {d["code"] for d in get_blueprint()["domains"]}
    assert set(heuristics["domains"]) == valid
    assert len(heuristics["universal"]) >= 5
    for code, items in heuristics["domains"].items():
        assert len(items) >= 3, f"{code} has too few domain-specific triggers"
        for item in items:
            assert item["trigger"].strip()
            assert item["points_to"].strip()
            assert item["why"].strip()

"""Loads and indexes the static exam content: blueprint, courses, questions, cheatsheets.

Content lives as JSON/Markdown under ``app/content`` so it is reviewable in pull
requests and versioned with the code. It is read once at import and held in
memory; the bank is small (hundreds of items) and entirely read-only at runtime.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any

from app.core.config import CONTENT_DIR

QUESTIONS_DIR = CONTENT_DIR / "questions"
CHEATSHEETS_DIR = CONTENT_DIR / "cheatsheets"

_VALID_DIFFICULTIES = {"foundational", "applied", "architect"}
_VALID_TYPES = {"single", "multi"}


class ContentError(RuntimeError):
    """Raised when the on-disk content bank is malformed."""


# --------------------------------------------------------------------------
# Models
# --------------------------------------------------------------------------
@dataclass(frozen=True, slots=True)
class Question:
    id: str
    domain: str
    difficulty: str
    type: str
    stem: str
    options: list[dict[str, str]]
    correct: list[str]
    explanation: str
    select_count: int = 1
    objective: str = ""
    distractor_notes: dict[str, str] = field(default_factory=dict)
    analogy: dict[str, str] | None = None
    snippet: dict[str, str] | None = None
    diagram: str | None = None
    cheatsheet: str = ""
    sources: list[str] = field(default_factory=list)
    tags: list[str] = field(default_factory=list)

    # -- serialisation -----------------------------------------------------
    def public(self) -> dict[str, Any]:
        """The candidate-facing view: no answer key, no explanation."""
        return {
            "id": self.id,
            "domain": self.domain,
            "difficulty": self.difficulty,
            "type": self.type,
            "select_count": self.select_count,
            "stem": self.stem,
            "options": self.options,
            "tags": self.tags,
        }

    def reveal(self) -> dict[str, Any]:
        """The post-submission view: everything, including the teaching material."""
        return {
            **self.public(),
            "objective": self.objective,
            "correct": self.correct,
            "explanation": self.explanation,
            "distractor_notes": self.distractor_notes,
            "analogy": self.analogy,
            "snippet": self.snippet,
            "diagram": self.diagram,
            "cheatsheet": self.cheatsheet,
            "sources": self.sources,
        }


@dataclass(frozen=True, slots=True)
class CheatSheet:
    slug: str
    domain: str
    title: str
    summary: str
    body: str
    sections: dict[str, str]

    def as_dict(self, anchor: str | None = None) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "slug": self.slug,
            "domain": self.domain,
            "title": self.title,
            "summary": self.summary,
            "body": self.body,
            "anchors": sorted(self.sections),
        }
        if anchor:
            payload["section"] = self.sections.get(anchor)
            payload["anchor"] = anchor
        return payload


# --------------------------------------------------------------------------
# Loading
# --------------------------------------------------------------------------
def _read_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:  # pragma: no cover - authoring error
        raise ContentError(f"{path.name} is not valid JSON: {exc}") from exc


def _validate(q: dict[str, Any], source: Path) -> None:
    where = f"{source.name}:{q.get('id', '<no id>')}"
    for key in ("id", "domain", "difficulty", "type", "stem", "options", "correct", "explanation"):
        if not q.get(key):
            raise ContentError(f"{where} is missing required field '{key}'")
    if q["difficulty"] not in _VALID_DIFFICULTIES:
        raise ContentError(f"{where} has unknown difficulty '{q['difficulty']}'")
    if q["type"] not in _VALID_TYPES:
        raise ContentError(f"{where} has unknown type '{q['type']}'")

    keys = [o["key"] for o in q["options"]]
    if len(set(keys)) != len(keys):
        raise ContentError(f"{where} has duplicate option keys")
    unknown = set(q["correct"]) - set(keys)
    if unknown:
        raise ContentError(f"{where} marks non-existent options correct: {sorted(unknown)}")

    expected = q.get("select_count", 1)
    if q["type"] == "single" and (len(q["correct"]) != 1 or expected != 1):
        raise ContentError(f"{where} is 'single' but does not have exactly one correct option")
    if q["type"] == "multi" and len(q["correct"]) != expected:
        raise ContentError(
            f"{where} declares select_count={expected} but marks {len(q['correct'])} correct"
        )


def _load_questions() -> dict[str, Question]:
    bank: dict[str, Question] = {}
    files = sorted(QUESTIONS_DIR.glob("*.json"))
    if not files:  # pragma: no cover - deployment error
        raise ContentError(f"No question files found in {QUESTIONS_DIR}")

    for path in files:
        payload = _read_json(path)
        items = payload["questions"] if isinstance(payload, dict) else payload
        for raw in items:
            _validate(raw, path)
            if raw["id"] in bank:
                raise ContentError(f"Duplicate question id {raw['id']} in {path.name}")
            bank[raw["id"]] = Question(
                id=raw["id"],
                domain=raw["domain"],
                difficulty=raw["difficulty"],
                type=raw["type"],
                stem=raw["stem"],
                options=raw["options"],
                correct=sorted(raw["correct"]),
                explanation=raw["explanation"],
                select_count=raw.get("select_count", 1),
                objective=raw.get("objective", ""),
                distractor_notes=raw.get("distractor_notes", {}),
                analogy=raw.get("analogy"),
                snippet=raw.get("snippet"),
                diagram=raw.get("diagram"),
                cheatsheet=raw.get("cheatsheet", ""),
                sources=raw.get("sources", []),
                tags=raw.get("tags", []),
            )
    return bank


_FRONTMATTER = re.compile(r"^---\n(.*?)\n---\n", re.DOTALL)


def _load_cheatsheets() -> dict[str, CheatSheet]:
    sheets: dict[str, CheatSheet] = {}
    for path in sorted(CHEATSHEETS_DIR.glob("*.md")):
        text = path.read_text(encoding="utf-8")
        meta: dict[str, str] = {}
        match = _FRONTMATTER.match(text)
        if match:
            for line in match.group(1).splitlines():
                if ":" in line:
                    key, _, value = line.partition(":")
                    meta[key.strip()] = value.strip()
            text = text[match.end() :]

        # Split on level-2 headings; the heading text is the anchor used by
        # a question's ``cheatsheet: "d3-agentic#hooks"`` reference.
        sections: dict[str, str] = {}
        current, buffer = None, []
        in_fence = False
        for line in text.splitlines():
            if line.lstrip().startswith("```"):
                in_fence = not in_fence
            if line.startswith("## ") and not in_fence:
                if current:
                    sections[current] = "\n".join(buffer).strip()
                current, buffer = line[3:].strip(), []
            else:
                buffer.append(line)
        if current:
            sections[current] = "\n".join(buffer).strip()

        slug = meta.get("slug", path.stem)
        sheets[slug] = CheatSheet(
            slug=slug,
            domain=meta.get("domain", ""),
            title=meta.get("title", slug),
            summary=meta.get("summary", ""),
            body=text.strip(),
            sections=sections,
        )
    return sheets


# --------------------------------------------------------------------------
# Public accessors
# --------------------------------------------------------------------------
@lru_cache(maxsize=1)
def get_blueprint() -> dict[str, Any]:
    return _read_json(CONTENT_DIR / "blueprint.json")


@lru_cache(maxsize=1)
def get_courses() -> dict[str, Any]:
    return _read_json(CONTENT_DIR / "courses.json")


@lru_cache(maxsize=1)
def get_questions() -> dict[str, Question]:
    return _load_questions()


@lru_cache(maxsize=1)
def get_cheatsheets() -> dict[str, CheatSheet]:
    return _load_cheatsheets()


@lru_cache(maxsize=1)
def questions_by_domain() -> dict[str, list[Question]]:
    index: dict[str, list[Question]] = {}
    for q in get_questions().values():
        index.setdefault(q.domain, []).append(q)
    for pool in index.values():
        pool.sort(key=lambda q: q.id)
    return index


def get_question(question_id: str) -> Question | None:
    return get_questions().get(question_id)


def domain_names() -> dict[str, str]:
    return {d["code"]: d["name"] for d in get_blueprint()["domains"]}


def resolve_cheatsheet(reference: str) -> dict[str, Any] | None:
    """Resolve a ``slug#anchor`` reference from a question to sheet content."""
    if not reference:
        return None
    slug, _, anchor = reference.partition("#")
    sheet = get_cheatsheets().get(slug)
    if not sheet:
        return None
    return sheet.as_dict(anchor or None)


def content_stats() -> dict[str, Any]:
    by_domain = questions_by_domain()
    names = domain_names()
    return {
        "total_questions": len(get_questions()),
        "domains": [
            {
                "code": code,
                "name": names.get(code, code),
                "count": len(pool),
                "difficulty": {
                    level: sum(1 for q in pool if q.difficulty == level)
                    for level in sorted(_VALID_DIFFICULTIES)
                },
            }
            for code, pool in sorted(by_domain.items())
        ],
        "cheatsheets": len(get_cheatsheets()),
        "courses": len(get_courses()["courses"]),
    }

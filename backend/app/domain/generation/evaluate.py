"""Judge a generated note against the constraints and report in a storable, readable form."""

from dataclasses import asdict
from typing import Any

from app.domain.constraints import (
    ConstraintConfig,
    ConstraintIssue,
    check_note,
    check_title,
    forbidden_word_issues,
    title_weight,
)
from app.domain.generation.schema import GeneratedNote

CHECKER_VERSION = "constraints-v1"


def _issue(i: ConstraintIssue) -> dict[str, Any]:
    return {
        "field": i.field,
        "code": i.code.value,
        "message": i.message,
        "details": i.details,
    }


def evaluate_note(
    note: GeneratedNote,
    *,
    required_words: list[str],
    forbidden_words: list[str],
    config: ConstraintConfig = ConstraintConfig(),
) -> dict[str, Any]:
    """Check every title candidate and the body with its tags.

    Returns a JSON-ready report: ``passed`` is true only when no candidate and nothing else failed, so the
    caller can retry or mark the version ``constraint_failed``. Forbidden words are looked for in the
    titles too (``check_note`` only sees the first one, so each title is checked on its own).
    """
    titles = []
    for index, title in enumerate(note.title_candidates):
        issues = check_title(title, config)
        issues += forbidden_word_issues("title", title, forbidden_words)
        titles.append(
            {
                "index": index,
                "text": title,
                "weight": title_weight(title),
                "issues": [_issue(i) for i in issues],
            }
        )
    body = check_note(
        title=note.title_candidates[0],
        body=note.body,
        tags=note.hashtags,
        required_words=required_words,
        forbidden_words=forbidden_words,
        config=config,
    )
    # The title was checked above; only body, tags and note-level findings are reported here.
    body_issues = [_issue(i) for i in body.issues if i.field != "title"]
    passed = not body_issues and all(not t["issues"] for t in titles)
    return {
        "passed": passed,
        "checker_version": CHECKER_VERSION,
        "titles": titles,
        "note": {"counts": asdict(body.counts), "issues": body_issues},
    }


def problems_from_report(report: dict[str, Any]) -> list[str]:
    """Plain-language problems to show the model on a retry."""
    problems = [
        f"标题「{t['text']}」：{i['message']}"
        for t in report["titles"]
        for i in t["issues"]
    ]
    problems += [i["message"] for i in report["note"]["issues"]]
    return problems

import json
import uuid
from unittest.mock import Mock

import pytest
from pydantic import ValidationError
from sqlmodel import Session

from app.fakes.llm import FakeLlmClient
from app.models import GenerationVersion, Task
from app.models.revision import ReviseRequest
from app.services import versions
from app.services.errors import InvalidStateError, ModelUnavailableError
from app.services.llm_structured import LlmOutputError


def content(body: str = "原始正文") -> dict[str, object]:
    return {
        "title_candidates": ["标题"],
        "body": body,
        "hashtags": ["标签"],
        "cover_candidates": ["封面"],
    }


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"parts": []},
        {"note": "   "},
        {"edited_note": None},
        {"parts": [{"target": "body"}, {"target": "body"}]},
        {"parts": [{"target": "unknown"}]},
        {"parts": [{"target": "body", "instruction": "字" * 501}]},
        {"parts": [{"target": "body", "extra": True}]},
        {"note": "字" * 501},
        {"extra": True},
        {"edited_note": {**content(), "title_candidates": []}},
        {"edited_note": {**content(), "title_candidates": ["  "]}},
        {"edited_note": {**content(), "body": "  "}},
        {"edited_note": {**content(), "hashtags": ["字"] * 21}},
        {"edited_note": {**content(), "cover_candidates": ["字"] * 6}},
    ],
)
def test_revision_rejects_empty_duplicate_unknown_and_invalid_edits(
    payload: dict[str, object],
) -> None:
    with pytest.raises(ValidationError):
        ReviseRequest.model_validate(payload)


def test_note_only_and_normalized_manual_only_have_explicit_model_rules() -> None:
    request = ReviseRequest.model_validate({"note": " 整体语气更温和 "})
    assert request.note == "整体语气更温和"
    assert [part.target for part in request.model_parts()] == ["body"]
    manual = ReviseRequest.model_validate(
        {
            "edited_note": {
                **content(),
                "title_candidates": [" 标题 ", " "],
                "hashtags": [" 标签 ", " "],
            }
        }
    )
    assert manual.model_parts() == []
    assert manual.edited_note is not None
    assert manual.edited_note.title_candidates == ["标题"]
    assert manual.edited_note.hashtags == ["标签"]


def setup_service(
    monkeypatch: pytest.MonkeyPatch,
) -> tuple[Session, Task, GenerationVersion, Mock, Mock]:
    task = Task(
        brand_id=uuid.uuid4(),
        scenario_id=uuid.uuid4(),
        style={},
        brief="",
        required_terms=[],
    )
    parent = GenerationVersion(
        task_id=task.id,
        brand_id=task.brand_id,
        version_no=1,
        flow_status="needs_human_review",
        **content(),
    )
    task.latest_version_id = parent.id
    task.flow_status = "needs_human_review"
    session = Mock(spec=Session)
    child = GenerationVersion(
        task_id=task.id,
        brand_id=task.brand_id,
        version_no=2,
        parent_version_id=parent.id,
        **content(),
    )

    def store(**_kwargs: object) -> GenerationVersion:
        task.latest_version_id = child.id
        return child

    save = Mock(side_effect=store)
    audit = Mock()
    monkeypatch.setattr(versions, "new_version_from", save)
    monkeypatch.setattr(versions, "record_audit", audit)
    monkeypatch.setattr(
        versions.evidence_service, "list_evidence", lambda **_kwargs: []
    )
    return session, task, parent, save, audit


def test_two_parts_work_in_memory_and_commit_one_child(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    session, task, parent, save, audit = setup_service(monkeypatch)
    fake = FakeLlmClient(
        [json.dumps(content("第一部分改好的正文")), json.dumps(content("最终正文"))]
    )
    request = ReviseRequest.model_validate(
        {
            "parts": [
                {"target": "body", "instruction": "保留来源"},
                {"target": "cover", "instruction": "短句"},
            ],
            "note": "整体温和",
        }
    )
    child = versions.revise_version(
        session=session,
        task=task,
        parent=parent,
        data=request,
        user_id=uuid.uuid4(),
        llm_factory=lambda: fake,
    )
    assert len(fake.requests) == 2
    assert "第一部分改好的正文" in fake.requests[1].messages[1].content
    assert all("整体温和" in req.messages[1].content for req in fake.requests)
    assert "保留来源" in fake.requests[0].messages[1].content
    save.assert_called_once()
    assert save.call_args.kwargs["parent"] is parent
    assert save.call_args.kwargs["note"].body == "最终正文"
    session.commit.assert_called_once()  # type: ignore[attr-defined]
    assert parent.body == "原始正文"
    assert child.parent_version_id == parent.id
    assert audit.call_count == 1


@pytest.mark.parametrize("manual_only", [True, False])
def test_manual_content_is_the_starting_note_and_has_a_separate_audit(
    monkeypatch: pytest.MonkeyPatch, manual_only: bool
) -> None:
    session, task, parent, save, audit = setup_service(monkeypatch)
    fake = FakeLlmClient([json.dumps(content("模型改后"))])
    factory = Mock(return_value=fake)
    request = ReviseRequest.model_validate(
        {
            "edited_note": content("人工原文"),
            "parts": [] if manual_only else [{"target": "titles"}],
        }
    )
    child = versions.revise_version(
        session=session,
        task=task,
        parent=parent,
        data=request,
        user_id=uuid.uuid4(),
        llm_factory=factory,
    )
    if manual_only:
        factory.assert_not_called()
        assert save.call_args.kwargs["note"].body == "人工原文"
        assert child.model is None
    else:
        assert "人工原文" in fake.requests[0].messages[1].content
    assert audit.call_count == 2
    assert audit.call_args.kwargs["action"] == "version.revise.manual_edit"
    assert "人工原文" not in str(audit.call_args_list)
    assert save.call_args.kwargs["origin"].value == "rewritten"


@pytest.mark.parametrize(
    "failure",
    [
        ModelUnavailableError("down"),
        "{}",
        json.dumps({**content(), "title_candidates": [" "]}),
    ],
)
def test_later_model_failure_never_stores_or_commits(
    monkeypatch: pytest.MonkeyPatch, failure: Exception | str
) -> None:
    session, task, parent, save, audit = setup_service(monkeypatch)
    fake = FakeLlmClient([json.dumps(content("第一部分")), failure])
    request = ReviseRequest.model_validate(
        {"parts": [{"target": "titles"}, {"target": "body"}]}
    )
    with pytest.raises((ModelUnavailableError, LlmOutputError)):
        versions.revise_version(
            session=session,
            task=task,
            parent=parent,
            data=request,
            user_id=uuid.uuid4(),
            llm_factory=lambda: fake,
        )
    save.assert_not_called()
    audit.assert_not_called()
    session.commit.assert_not_called()  # type: ignore[attr-defined]
    assert task.latest_version_id == parent.id


@pytest.mark.parametrize("where", ["task", "version"])
def test_generating_state_is_rejected_before_model_or_storage(
    monkeypatch: pytest.MonkeyPatch, where: str
) -> None:
    session, task, parent, save, _ = setup_service(monkeypatch)
    if where == "task":
        task.flow_status = "generating"
    else:
        parent.flow_status = "generating"
    factory = Mock()
    with pytest.raises(InvalidStateError):
        versions.revise_version(
            session=session,
            task=task,
            parent=parent,
            data=ReviseRequest.model_validate({"note": "改正文"}),
            user_id=uuid.uuid4(),
            llm_factory=factory,
        )
    factory.assert_not_called()
    save.assert_not_called()

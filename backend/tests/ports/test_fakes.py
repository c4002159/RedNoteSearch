import dataclasses
from uuid import uuid4

import pytest

from app.fakes import (
    FakeKnowledgeSearch,
    FakeTaskInputRepository,
    FakeVoiceProfileProvider,
)
from app.fakes.knowledge import DocumentStatus
from app.ports import (
    KnowledgeSearch,
    TaskInputRepository,
    VoiceProfile,
    VoiceProfileProvider,
    content_hash,
)


def test_fakes_satisfy_the_ports() -> None:
    assert isinstance(FakeKnowledgeSearch(), KnowledgeSearch)
    assert isinstance(FakeTaskInputRepository(), TaskInputRepository)
    assert isinstance(FakeVoiceProfileProvider(), VoiceProfileProvider)


def test_search_never_crosses_brands() -> None:
    brand_a, brand_b = uuid4(), uuid4()
    kb = FakeKnowledgeSearch()
    kb.add_document(brand_id=brand_a, chunks=["木质香调 前调佛手柑"])
    assert kb.search(brand_id=brand_b, query="木质香调") == []
    assert len(kb.search(brand_id=brand_a, query="木质香调")) == 1


@pytest.mark.parametrize("status", ["pending_review", "rejected", "deactivated"])
def test_search_excludes_documents_that_are_not_approved(
    status: DocumentStatus,
) -> None:
    brand = uuid4()
    kb = FakeKnowledgeSearch()
    kb.add_document(brand_id=brand, chunks=["唯一短语"], status=status)
    assert kb.search(brand_id=brand, query="唯一短语") == []


def test_search_excludes_superseded_versions_and_reports_the_version() -> None:
    brand = uuid4()
    doc_id = uuid4()
    kb = FakeKnowledgeSearch()
    kb.add_document(
        brand_id=brand,
        chunks=["旧版奖项"],
        version=1,
        is_current=False,
        document_id=doc_id,
    )
    kb.add_document(
        brand_id=brand,
        chunks=["新版奖项"],
        version=2,
        is_current=True,
        document_id=doc_id,
    )
    assert kb.search(brand_id=brand, query="旧版奖项") == []
    [hit] = kb.search(brand_id=brand, query="新版奖项")
    assert hit.source_level == "approved_kb"
    assert hit.document_id == doc_id
    assert hit.document_version == 2
    assert hit.snapshot_id is None


def test_task_material_is_only_visible_to_its_own_task() -> None:
    brand = uuid4()
    task, other_task = uuid4(), uuid4()
    inputs = FakeTaskInputRepository()
    kb = FakeKnowledgeSearch(task_inputs=inputs)
    snapshot = inputs.create_snapshot(
        brand_id=brand, task_id=task, filename="brief.txt", text="临时资料 限定礼盒"
    )

    assert kb.search(brand_id=brand, query="限定礼盒") == []
    assert kb.search(brand_id=brand, query="限定礼盒", task_id=other_task) == []
    assert kb.search(brand_id=uuid4(), query="限定礼盒", task_id=task) == []
    [hit] = kb.search(brand_id=brand, query="限定礼盒", task_id=task)
    assert hit.source_level == "task_material"
    assert hit.snapshot_id == snapshot.id
    assert hit.document_id is None
    assert hit.content_hash == content_hash("临时资料 限定礼盒")


def test_search_orders_by_score_and_respects_limit() -> None:
    brand = uuid4()
    kb = FakeKnowledgeSearch()
    kb.add_document(brand_id=brand, chunks=["木质", "木质 香调", "无关内容"])
    hits = kb.search(brand_id=brand, query="木质 香调", limit=2)
    assert [h.content for h in hits] == ["木质 香调", "木质"]
    assert hits[0].score > hits[1].score
    assert kb.search(brand_id=brand, query="   ") == []


def test_snapshots_are_immutable_hashed_and_scoped() -> None:
    brand, task = uuid4(), uuid4()
    repo = FakeTaskInputRepository()
    snapshot = repo.create_snapshot(
        brand_id=brand, task_id=task, filename="a.txt", text="内容"
    )
    assert snapshot.content_hash == content_hash("内容")
    with pytest.raises(dataclasses.FrozenInstanceError):
        snapshot.content = "被改动"  # type: ignore[misc]
    assert repo.list_snapshots(brand_id=brand, task_id=task) == [snapshot]
    assert repo.list_snapshots(brand_id=uuid4(), task_id=task) == []
    assert repo.list_snapshots(brand_id=brand, task_id=uuid4()) == []


def test_content_hash_is_stable_sha256() -> None:
    assert content_hash("a") == (
        "ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb"
    )


def test_voice_profile_is_per_brand() -> None:
    brand, other = uuid4(), uuid4()
    provider = FakeVoiceProfileProvider()
    assert provider.get_active(brand_id=brand) is None
    profile = VoiceProfile(
        brand_id=brand, version=3, persona="温柔克制", forbidden_words=("最",)
    )
    provider.set_active(profile)
    assert provider.get_active(brand_id=brand) == profile
    assert provider.get_active(brand_id=other) is None

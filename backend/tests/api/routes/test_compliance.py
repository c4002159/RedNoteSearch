"""Compliance rules (editable by people) and risk-hint checks on versions. Needs the database."""

import json
import uuid
from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, delete, select

from app.core.config import settings
from app.fakes.llm import FakeLlmClient
from app.models import (
    AuditLog,
    Brand,
    ClaimEvidence,
    ComplianceCheck,
    ComplianceRule,
    GenerationVersion,
    Tenant,
)
from app.services.compliance import (
    SAMPLE_SOURCE,
    check_compliance,
    ensure_sample_rules,
    summarize,
)
from app.services.errors import ModelUnavailableError
from app.services.scenarios import ensure_default_scenarios
from tests.api.routes.test_brands import _add_member, _create_brand, _make_user

API = settings.API_V1_STR
RULE = {
    "layer": "lexicon",
    "rule_type": "brand_forbidden",
    "pattern": "神仙水",
    "severity": "warn",
    "suggestion": "不要借用其他品牌的名称",
    "source_name": "品牌内部规定",
}


@pytest.fixture(scope="module", autouse=True)
def cleanup(db: Session) -> Generator[None]:
    ensure_default_scenarios(db)
    ensure_sample_rules(db)
    yield
    db.rollback()
    db.execute(delete(Brand))
    db.execute(delete(ComplianceRule).where(ComplianceRule.is_sample.is_(False)))  # type: ignore[attr-defined]
    db.execute(delete(Tenant))
    db.commit()


def _version(
    client: TestClient,
    db: Session,
    headers: dict[str, str],
    body: str,
    *,
    titles: list[str] | None = None,
) -> GenerationVersion:
    brand = _create_brand(client, headers)
    product = client.post(
        f"{API}/brands/{brand['id']}/products", headers=headers, json={"name": "晨雾"}
    ).json()
    scenario = client.get(f"{API}/scenarios", headers=headers).json()["items"][0]
    task = client.post(
        f"{API}/tasks",
        headers=headers,
        json={
            "brand_id": brand["id"],
            "product_id": product["id"],
            "scenario_id": scenario["id"],
        },
    ).json()
    version = GenerationVersion(
        task_id=uuid.UUID(task["id"]),
        brand_id=uuid.UUID(brand["id"]),
        version_no=1,
        title_candidates=titles or ["清爽的一天"],
        body=body,
        hashtags=["日常"],
    )
    db.add(version)
    db.commit()
    db.refresh(version)
    return version


def test_sample_rules_are_marked_as_unverified_and_created_once(db: Session) -> None:
    assert ensure_sample_rules(db) == 0
    samples = db.exec(
        select(ComplianceRule).where(ComplianceRule.is_sample.is_(True))
    ).all()  # type: ignore[attr-defined]
    assert len(samples) >= 10 and {r.brand_id for r in samples} == {None}
    assert {r.source_name for r in samples} == {SAMPLE_SOURCE}
    assert "待人工核对" in SAMPLE_SOURCE and all(r.enabled for r in samples)


def test_rule_listing_visibility_and_filters(
    client: TestClient, db: Session, superuser_token_headers: dict[str, str]
) -> None:
    brand = _create_brand(client, superuser_token_headers)
    other = _create_brand(client, superuser_token_headers)
    admin, admin_headers = _make_user(client, db)
    _, outsider_headers = _make_user(client, db)
    _add_member(client, superuser_token_headers, brand["id"], admin, "admin")
    own = client.post(
        f"{API}/brands/{brand['id']}/compliance-rules", headers=admin_headers, json=RULE
    ).json()
    hidden = client.post(
        f"{API}/brands/{other['id']}/compliance-rules",
        headers=superuser_token_headers,
        json={**RULE, "pattern": "别家的词"},
    ).json()

    ids = lambda h, q="": {  # noqa: E731
        r["id"]
        for r in client.get(
            f"{API}/compliance-rules?page_size=100{q}", headers=h
        ).json()["items"]
    }
    assert own["id"] in ids(admin_headers) and hidden["id"] not in ids(admin_headers)
    assert own["id"] not in ids(outsider_headers)  # other brands' rules stay private
    assert own["id"] in ids(admin_headers, f"&brand_id={brand['id']}")
    assert (
        client.get(
            f"{API}/compliance-rules?brand_id={brand['id']}", headers=outsider_headers
        ).status_code
        == 403
    )
    only = client.get(
        f"{API}/compliance-rules?layer=lexicon&rule_type=brand_forbidden&severity=warn&brand_id={brand['id']}",
        headers=admin_headers,
    ).json()
    assert [r["pattern"] for r in only["items"]] == ["神仙水"]
    assert (
        client.get(
            f"{API}/compliance-rules?severity=bad", headers=admin_headers
        ).status_code
        == 422
    )
    # scope narrows the mixed list to one side, so each tab can page and count on its own
    brand_only = client.get(
        f"{API}/compliance-rules?scope=brand&brand_id={brand['id']}",
        headers=admin_headers,
    ).json()
    assert [r["id"] for r in brand_only["items"]] == [own["id"]]
    assert brand_only["total"] == 1
    global_only = client.get(
        f"{API}/compliance-rules?scope=global&brand_id={brand['id']}&page_size=100",
        headers=admin_headers,
    ).json()
    assert global_only["items"] and all(
        r["brand_id"] is None for r in global_only["items"]
    )
    assert (
        client.get(
            f"{API}/compliance-rules?scope=brand", headers=admin_headers
        ).status_code
        == 422
    )
    assert (
        client.get(
            f"{API}/compliance-rules?scope=brand&brand_id={brand['id']}",
            headers=outsider_headers,
        ).status_code
        == 403
    )
    page = client.get(
        f"{API}/compliance-rules?page=1&page_size=2", headers=admin_headers
    ).json()
    assert len(page["items"]) == 2 and page["total"] >= 11
    assert (
        client.get(
            f"{API}/compliance-rules?page_size=101", headers=admin_headers
        ).status_code
        == 422
    )

    assert (
        client.get(
            f"{API}/compliance-rules/{own['id']}", headers=admin_headers
        ).status_code
        == 200
    )
    assert (
        client.get(
            f"{API}/compliance-rules/{own['id']}", headers=outsider_headers
        ).status_code
        == 404
    )
    global_id = next(iter(ids(outsider_headers)))
    assert (
        client.get(
            f"{API}/compliance-rules/{global_id}", headers=outsider_headers
        ).status_code
        == 200
    )
    assert (
        client.get(
            f"{API}/compliance-rules/{uuid.uuid4()}", headers=admin_headers
        ).status_code
        == 404
    )
    assert client.get(f"{API}/compliance-rules").status_code == 401


def test_creating_rules_needs_the_right_role_and_a_safe_pattern(
    client: TestClient, db: Session, superuser_token_headers: dict[str, str]
) -> None:
    brand = _create_brand(client, superuser_token_headers)
    editor, editor_headers = _make_user(client, db)
    _add_member(client, superuser_token_headers, brand["id"], editor, "editor")
    brand_url = f"{API}/brands/{brand['id']}/compliance-rules"

    assert client.post(brand_url, headers=editor_headers, json=RULE).status_code == 403
    assert (
        client.post(
            f"{API}/compliance-rules", headers=editor_headers, json=RULE
        ).status_code
        == 403
    )
    created = client.post(
        f"{API}/compliance-rules", headers=superuser_token_headers, json=RULE
    )
    assert created.status_code == 201 and created.json()["brand_id"] is None
    assert created.json()["rule_version"] == 1 and created.json()["is_sample"] is False

    plain = client.post(
        brand_url, headers=superuser_token_headers, json={**RULE, "pattern": "(["}
    )
    assert plain.status_code == 201  # the same text is harmless as plain words
    for bad in (
        {"pattern": "(a+)+", "is_regex": True},  # could hang the check
        {"pattern": "([", "is_regex": True},
        {"layer": "context"},  # the model-based layer has no pattern to configure
        {"pattern": ""},
        {"pattern": "x" * 201},
        {"source_name": ""},
        {"severity": "fatal"},
    ):
        r = client.post(
            brand_url, headers=superuser_token_headers, json={**RULE, **bad}
        )
        assert r.status_code == 422, (bad, r.text)
    # A platform administrator is not a master key for brand data: they must be an admin of the brand.
    assert (
        client.post(
            f"{API}/brands/{uuid.uuid4()}/compliance-rules",
            headers=superuser_token_headers,
            json=RULE,
        ).status_code
        == 403
    )


def test_editing_a_rule_raises_its_version_and_can_switch_it_off(
    client: TestClient, db: Session, superuser_token_headers: dict[str, str]
) -> None:
    brand = _create_brand(client, superuser_token_headers)
    admin, admin_headers = _make_user(client, db)
    editor, editor_headers = _make_user(client, db)
    other_admin, other_headers = _make_user(client, db)
    _add_member(client, superuser_token_headers, brand["id"], admin, "admin")
    _add_member(client, superuser_token_headers, brand["id"], editor, "editor")
    rule = client.post(
        f"{API}/brands/{brand['id']}/compliance-rules", headers=admin_headers, json=RULE
    ).json()
    url = f"{API}/compliance-rules/{rule['id']}"

    edited = client.patch(
        url, headers=admin_headers, json={"severity": "block", "suggestion": "改写"}
    )
    assert edited.status_code == 200
    assert (
        edited.json()["rule_version"],
        edited.json()["severity"],
        edited.json()["suggestion"],
    ) == (2, "block", "改写")
    assert (
        client.patch(url, headers=admin_headers, json={"enabled": False}).json()[
            "enabled"
        ]
        is False
    )
    assert (
        client.patch(
            url, headers=admin_headers, json={"enabled": None, "pattern": None}
        ).json()["pattern"]
        == "神仙水"
    )
    assert (
        client.patch(url, headers=editor_headers, json={"enabled": True}).status_code
        == 403
    )
    assert (
        client.patch(url, headers=other_headers, json={"enabled": True}).status_code
        == 404
    )  # not even visible
    assert (
        client.patch(
            url, headers=admin_headers, json={"pattern": "([", "is_regex": True}
        ).status_code
        == 422
    )
    assert (
        client.patch(
            url,
            headers=admin_headers,
            json={"effective_from": "2026-12-01", "effective_to": "2026-01-01"},
        ).status_code
        == 422
    )
    assert (
        client.patch(
            f"{API}/compliance-rules/{uuid.uuid4()}", headers=admin_headers, json={}
        ).status_code
        == 404
    )

    sample = db.exec(
        select(ComplianceRule).where(ComplianceRule.is_sample.is_(True))
    ).first()  # type: ignore[attr-defined]
    assert sample is not None
    assert (
        client.patch(
            f"{API}/compliance-rules/{sample.id}",
            headers=admin_headers,
            json={"enabled": False},
        ).status_code
        == 403
    )
    assert (
        client.patch(
            f"{API}/compliance-rules/{sample.id}",
            headers=superuser_token_headers,
            json={"source_name": "已核对：某某办法"},
        ).json()["is_sample"]
        is False
    )
    db.expire_all()
    actions = [
        a.action
        for a in db.exec(
            select(AuditLog).where(AuditLog.entity_id == uuid.UUID(rule["id"]))
        ).all()
    ]
    assert (
        actions.count("compliance_rule.update") >= 2
        and "compliance_rule.create" in actions
    )
    db.execute(delete(ComplianceRule).where(ComplianceRule.id == sample.id))
    db.commit()
    ensure_sample_rules(db)  # restore the sample the test edited


def test_checks_find_rule_hits_and_soften_efficacy_claims_that_have_support(
    client: TestClient, db: Session, superuser_token_headers: dict[str, str]
) -> None:
    version = _version(
        client,
        db,
        superuser_token_headers,
        "这是最好的香水。资料说它能美白。我觉得它能祛斑，含 99% 天然成分。",
        titles=["顶级香气"],
    )
    db.add(
        ClaimEvidence(
            version_id=version.id,
            brand_id=version.brand_id,
            claim_text="资料说它能美白",
            status="system_supported",
        )
    )
    db.commit()

    rows = check_compliance(session=db, version=version, llm=None)
    db.commit()
    by_text = {(r.field, r.matched_text): r for r in rows}
    best = by_text[("body", "最好")]
    assert (best.layer, best.severity, best.rule_version, best.source_name) == (
        "lexicon",
        "block",
        1,
        SAMPLE_SOURCE,
    )
    assert (
        (best.span_start, best.span_end) == (2, 4)
        and best.suggestion
        and not best.resolved
    )
    assert ("title.0", "顶级") in by_text
    backed, unbacked = by_text[("body", "美白")], by_text[("body", "祛斑")]
    assert (backed.basis, backed.severity) == ("found", "warn")
    assert (unbacked.basis, unbacked.severity) == ("none", "block")
    assert ("body", "99%") in by_text and by_text[
        ("body", "99%")
    ].rule_type == "data_claim"
    summary = summarize(rows)
    assert summary.unresolved_block >= 3 and summary.total == len(rows)

    # A new check replaces the old hints instead of piling up.
    again = check_compliance(session=db, version=version, llm=None)
    db.commit()
    assert len(
        db.exec(
            select(ComplianceCheck).where(ComplianceCheck.version_id == version.id)
        ).all()
    ) == len(again)

    # Brand rules apply to the brand's own versions, and a disabled rule is ignored.
    brand_rule = ComplianceRule(
        brand_id=version.brand_id,
        layer="lexicon",
        rule_type="brand_forbidden",
        pattern="清爽",
        severity="warn",
        source_name="内部",
    )
    disabled = ComplianceRule(
        brand_id=version.brand_id,
        layer="lexicon",
        rule_type="brand_forbidden",
        pattern="香水",
        severity="warn",
        source_name="内部",
        enabled=False,
    )
    db.add_all([brand_rule, disabled])
    db.commit()
    matched = {
        r.matched_text for r in check_compliance(session=db, version=version, llm=None)
    }
    assert "香水" not in matched and "最好" in matched
    version.body = "今天很清爽"
    version.title_candidates = ["早安"]
    db.add(version)
    db.commit()
    assert [
        (r.matched_text, r.rule_id)
        for r in check_compliance(session=db, version=version, llm=None)
    ] == [("清爽", brand_rule.id)]


def test_context_layer_uses_the_model_and_ignores_invented_sentences(
    client: TestClient, db: Session, superuser_token_headers: dict[str, str]
) -> None:
    version = _version(
        client, db, superuser_token_headers, "用了皮肤会重新变得年轻。味道很温柔。"
    )
    llm = FakeLlmClient(
        [
            json.dumps(
                {
                    "findings": [
                        {
                            "sentence": "用了皮肤会重新变得年轻",
                            "concern": "暗示功效",
                            "severity": "block",
                            "suggestion": "删除这句",
                        },
                        {"sentence": "文中没有这句话", "concern": "编造"},
                    ]
                },
                ensure_ascii=False,
            )
        ]
    )
    rows = check_compliance(session=db, version=version, llm=llm)
    db.commit()
    context = [r for r in rows if r.layer == "context"]
    assert [
        (r.matched_text, r.severity, r.rule_id, r.source_name) for r in context
    ] == [("用了皮肤会重新变得年轻", "block", None, "模型语境判断")]
    assert llm.requests[0].purpose == "compliance_context"

    before = {
        r.id
        for r in db.exec(
            select(ComplianceCheck).where(ComplianceCheck.version_id == version.id)
        ).all()
    }
    with pytest.raises(ModelUnavailableError):
        check_compliance(
            session=db,
            version=version,
            llm=FakeLlmClient([ModelUnavailableError("down")]),
        )
    db.rollback()
    after = {
        r.id
        for r in db.exec(
            select(ComplianceCheck).where(ComplianceCheck.version_id == version.id)
        ).all()
    }
    assert after == before  # a model failure leaves the previous hints in place


def test_endpoints_list_hints_and_record_that_a_person_dealt_with_them(
    client: TestClient, db: Session, superuser_token_headers: dict[str, str]
) -> None:
    version = _version(client, db, superuser_token_headers, "这是最好的，也是唯一的。")
    check_compliance(session=db, version=version, llm=None)
    db.commit()
    member, member_headers = _make_user(client, db)
    _, outsider_headers = _make_user(client, db)
    _add_member(
        client, superuser_token_headers, str(version.brand_id), member, "editor"
    )

    listed = client.get(
        f"{API}/generation-versions/{version.id}/compliance", headers=member_headers
    ).json()
    assert listed["unresolved_block"] == 2 and len(listed["items"]) == 2
    first = listed["items"][0]
    assert (
        first["span"] == [2, 4]
        and first["resolved"] is False
        and first["source_name"] == SAMPLE_SOURCE
    )

    url = f"{API}/compliance-checks/{first['id']}/resolve"
    done = client.post(
        url, headers=member_headers, json={"note": "品牌方确认这里是引用"}
    )
    assert (
        done.status_code == 200
        and done.json()["resolved"] is True
        and done.json()["resolved_note"] == "品牌方确认这里是引用"
    )
    assert (
        done.json()["severity"] == "block"
    )  # the hint stays; only its handling is recorded
    again = client.get(
        f"{API}/generation-versions/{version.id}/compliance", headers=member_headers
    ).json()
    assert again["unresolved_block"] == 1
    assert (
        client.post(url, headers=member_headers, json={"note": ""}).status_code == 422
    )
    assert client.post(url, headers=member_headers, json={}).status_code == 422
    for path in (
        f"/compliance-checks/{first['id']}/resolve",
        f"/compliance-checks/{uuid.uuid4()}/resolve",
    ):
        assert (
            client.post(
                f"{API}{path}", headers=outsider_headers, json={"note": "x"}
            ).status_code
            == 404
        )
    assert (
        client.get(
            f"{API}/generation-versions/{version.id}/compliance",
            headers=outsider_headers,
        ).status_code
        == 404
    )
    assert client.post(url, json={"note": "x"}).status_code == 401

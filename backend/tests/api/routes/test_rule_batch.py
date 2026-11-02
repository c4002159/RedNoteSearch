import uuid

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.models import AuditLog, ComplianceRule
from tests.api.routes.test_brands import _add_member, _create_brand, _make_user
from tests.api.routes.test_compliance import API, RULE


def test_partial_scope_disable_restore_and_list_visibility(
    client: TestClient, db: Session, superuser_token_headers: dict[str, str]
) -> None:
    h = superuser_token_headers
    brand = _create_brand(client, h)
    other = _create_brand(client, h)
    row = client.post(
        f"{API}/brands/{brand['id']}/compliance-rules", headers=h, json=RULE
    ).json()
    foreign = client.post(
        f"{API}/brands/{other['id']}/compliance-rules", headers=h, json=RULE
    ).json()
    url = f"{API}/brands/{brand['id']}/compliance-rules/batch-state"
    response = client.post(
        url,
        headers=h,
        json={
            "ids": [row["id"], foreign["id"], str(uuid.uuid4())],
            "enabled": False,
            "reason": "调整来源",
        },
    )
    assert response.status_code == 200, response.text
    items = response.json()["items"]
    assert [item["status_code"] for item in items] == [200, 404, 404]
    assert items[0]["changed"] and items[0]["rule_version"] == 2
    assert (
        client.get(
            f"{API}/compliance-rules?brand_id={brand['id']}&scope=brand&include_inactive=false",
            headers=h,
        ).json()["total"]
        == 0
    )
    assert (
        client.get(
            f"{API}/compliance-rules?brand_id={brand['id']}&scope=brand", headers=h
        ).json()["total"]
        == 1
    )
    same = client.post(
        url,
        headers=h,
        json={"ids": [row["id"]], "enabled": False, "reason": "重复确认"},
    ).json()["items"][0]
    assert same["success"] and not same["changed"] and same["rule_version"] == 2
    restored = client.post(
        url, headers=h, json={"ids": [row["id"]], "enabled": True, "reason": "恢复使用"}
    ).json()["items"][0]
    assert restored["success"] and restored["rule_version"] == 3
    assert (
        client.get(
            f"{API}/compliance-rules?brand_id={brand['id']}&scope=brand&include_inactive=false",
            headers=h,
        ).json()["total"]
        == 1
    )
    db.expire_all()
    assert db.get(ComplianceRule, uuid.UUID(foreign["id"])).enabled is True  # type: ignore[union-attr]
    logs = db.exec(
        select(AuditLog).where(
            AuditLog.entity_id == uuid.UUID(row["id"]),
            AuditLog.action == "compliance_rule.batch_state",
        )
    ).all()
    assert len(logs) == 3 and all(
        set(log.detail) == {"enabled", "changed", "rule_version", "reason"}
        for log in logs
    )


def test_batch_authorization_and_validation(
    client: TestClient, db: Session, superuser_token_headers: dict[str, str]
) -> None:
    h = superuser_token_headers
    brand = _create_brand(client, h)
    row = client.post(f"{API}/compliance-rules", headers=h, json=RULE).json()
    url = f"{API}/brands/{brand['id']}/compliance-rules/batch-state"
    body = {"ids": [row["id"]], "enabled": False, "reason": "调整"}
    assert client.post(url, json=body).status_code == 401
    editor, editor_h = _make_user(client, db)
    _add_member(client, h, brand["id"], editor, "editor")
    _, outsider_h = _make_user(client, db)
    assert client.post(url, headers=editor_h, json=body).status_code == 403
    assert client.post(url, headers=outsider_h, json=body).status_code == 403
    global_url = f"{API}/compliance-rules/batch-state"
    assert client.post(global_url, headers=editor_h, json=body).status_code == 403
    assert (
        client.post(global_url, headers=h, json=body).json()["items"][0]["success"]
        is True
    )
    for invalid in (
        {**body, "ids": []},
        {**body, "ids": [row["id"]] * 2},
        {**body, "ids": [str(uuid.uuid4()) for _ in range(101)]},
        {**body, "enabled": "false"},
        {**body, "reason": " "},
    ):
        assert client.post(url, headers=h, json=invalid).status_code == 422

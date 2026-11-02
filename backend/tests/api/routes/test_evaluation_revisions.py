import uuid

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.models import EvalRun
from tests.api.routes.test_brands import _add_member, _create_brand, _make_user
from tests.api.routes.test_evaluation import API, COMPLIANCE_CASES, _dataset


def test_revision_retains_original_runs_and_allocates_group_versions(
    client: TestClient, db: Session, superuser_token_headers: dict[str, str]
) -> None:
    h = superuser_token_headers
    brand = _create_brand(client, h)
    original = _dataset(client, h, "compliance", COMPLIANCE_CASES, brand_id=brand["id"])
    old_cases = client.get(
        f"{API}/evaluation/datasets/{original['id']}/cases", headers=h
    ).json()
    run = EvalRun(
        dataset_id=uuid.UUID(original["id"]),
        model_ids=[],
        status="completed",
        sample_count=3,
    )
    db.add(run)
    db.commit()
    run_id = run.id
    url = f"{API}/evaluation/datasets/{original['id']}/revisions"
    edit = {
        "case_index": 1,
        "input": {"text": "日常香气"},
        "expected": {"hit_words": []},
    }
    response = client.post(
        url, headers=h, json={"updates": [edit], "delete_case_indexes": [0]}
    )
    assert response.status_code == 201, response.text
    v2 = response.json()
    assert (v2["group_id"], v2["version"], v2["case_count"]) == (
        original["group_id"],
        2,
        2,
    )
    assert v2["content_hash"] != original["content_hash"]
    assert (
        client.get(
            f"{API}/evaluation/datasets/{original['id']}/cases", headers=h
        ).json()
        == old_cases
    )
    assert db.exec(
        select(EvalRun).where(EvalRun.id == run_id)
    ).one().dataset_id == uuid.UUID(original["id"])
    new_cases = client.get(
        f"{API}/evaluation/datasets/{v2['id']}/cases", headers=h
    ).json()["items"]
    assert [row["case_index"] for row in new_cases] == [0, 1]
    assert new_cases[0]["input"] == {"text": "日常香气"}
    assert (
        client.post(url, headers=h, json={"delete_case_indexes": [0]}).json()["version"]
        == 3
    )
    for body in (
        {},
        {"delete_case_indexes": [0, 1, 2]},
        {"delete_case_indexes": [9]},
        {"updates": [edit], "delete_case_indexes": [1]},
        {"updates": [{**edit, "input": {"text": ""}}]},
    ):
        assert client.post(url, headers=h, json=body).status_code == 422
    assert (
        client.post(url, headers=h, json={"delete_case_indexes": [0]}).json()["version"]
        == 4
    )


def test_revision_authorization_and_scope_are_inherited(
    client: TestClient, db: Session, superuser_token_headers: dict[str, str]
) -> None:
    h = superuser_token_headers
    brand = _create_brand(client, h)
    original = _dataset(client, h, "compliance", COMPLIANCE_CASES, brand_id=brand["id"])
    url = f"{API}/evaluation/datasets/{original['id']}/revisions"
    body = {"delete_case_indexes": [0]}
    assert client.post(url, json=body).status_code == 401
    editor, editor_h = _make_user(client, db)
    _add_member(client, h, brand["id"], editor, "editor")
    outsider, outsider_h = _make_user(client, db)
    assert client.post(url, headers=editor_h, json=body).status_code == 404
    assert client.post(url, headers=outsider_h, json=body).status_code == 404
    other = _create_brand(client, h)
    _add_member(client, h, other["id"], outsider, "admin")
    assert client.post(url, headers=outsider_h, json=body).status_code == 404
    assert (
        client.post(
            f"{API}/evaluation/datasets/{uuid.uuid4()}/revisions", headers=h, json=body
        ).status_code
        == 404
    )
    global_set = _dataset(client, h, "compliance", COMPLIANCE_CASES)
    assert (
        client.post(
            f"{API}/evaluation/datasets/{global_set['id']}/revisions",
            headers=outsider_h,
            json=body,
        ).status_code
        == 403
    )
    assert (
        client.post(
            f"{API}/evaluation/datasets/{global_set['id']}/revisions",
            headers=h,
            json=body,
        ).status_code
        == 201
    )

"""TC-158..182: bulk rules, using PostgreSQL and no model calls."""

import json
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor

import pytest
from sqlalchemy import text
from sqlmodel import Session, delete, select

from app.core.config import settings
from app.core.db import engine
from app.domain.compliance.import_rules import MAX_BYTES, parse_file
from app.models import AuditLog, Brand, BrandMember, ComplianceRule, Tenant
from app.services import rule_import as service
from app.services.errors import ConflictError, InvalidInputError
from tests.api.routes.test_brands import _add_member, _create_brand, _make_user

API = settings.API_V1_STR
RULE = {
    "layer": "lexicon",
    "rule_type": "brand_forbidden",
    "severity": "warn",
    "pattern": "虚构别家词",
}


@pytest.fixture(scope="module", autouse=True)
def cleanup(db):
    yield
    db.rollback()
    db.exec(delete(Brand))
    db.exec(delete(ComplianceRule))
    db.exec(delete(Tenant))
    db.commit()


def upload(
    client, headers, path, rows=None, *, content=None, name="rules.json", **params
):
    if content is None:
        content = json.dumps(
            rows if rows is not None else [RULE], ensure_ascii=False
        ).encode()
    return client.post(
        f"{API}{path}/import",
        headers=headers,
        params=params,
        files={"file": (name, content)},
    )


def brand_path(client, headers):
    brand = _create_brand(client, headers)
    return f"/brands/{brand['id']}/compliance-rules", uuid.UUID(brand["id"])


def rows(db, brand_id):
    db.expire_all()
    return service.scope_rows(db, brand_id)


def audits(db, brand_id):
    return list(
        db.exec(
            select(AuditLog).where(
                AuditLog.action == "compliance.import", AuditLog.brand_id == brand_id
            )
        ).all()
    )


def test_preview_merge_replace_audit_and_restore(client, db, superuser_token_headers):
    headers = superuser_token_headers
    path, bid = brand_path(client, headers)
    preview = upload(client, headers, path)
    assert preview.status_code == 200
    assert preview.json() == {
        "dry_run": True,
        "mode": "merge",
        "created": 1,
        "updated": 0,
        "unchanged": 0,
        "disabled": 0,
        "errors": [],
    }
    assert rows(db, bid) == [] and audits(db, bid) == []
    applied = upload(client, headers, path, dry_run=False)
    assert applied.status_code == 200 and applied.json()["created"] == 1
    row = rows(db, bid)[0]
    assert row.source_name == "" and not row.is_sample and row.rule_version == 1
    log = audits(db, bid)[0]
    assert log.detail == {
        "scope": str(bid),
        "mode": "merge",
        "created": 1,
        "updated": 0,
        "unchanged": 0,
        "disabled": 0,
        "filename": "rules.json",
    }
    assert RULE["pattern"] not in json.dumps(log.detail, ensure_ascii=False)
    before = row.updated_at
    again = upload(client, headers, path, dry_run=False)
    assert again.json()["unchanged"] == 1
    assert rows(db, bid)[0].updated_at == before and len(audits(db, bid)) == 2
    changed = {**RULE, "severity": "block", "enabled": False, "source_url": ""}
    response = upload(client, headers, path, [changed], dry_run=False)
    assert response.json()["updated"] == 1 and response.json()["disabled"] == 0
    row = rows(db, bid)[0]
    assert not row.enabled and row.rule_version == 2 and row.source_url is None
    assert upload(client, headers, path, dry_run=False).json()["updated"] == 1
    added = {**RULE, "pattern": "范围内新词"}
    preview = upload(client, headers, path, [added], mode="replace")
    assert preview.json()["created"] == 1 and preview.json()["disabled"] == 1
    assert rows(db, bid)[0].enabled and len(audits(db, bid)) == 4
    applied = upload(client, headers, path, [added], mode="replace", dry_run=False)
    assert applied.json()["disabled"] == 1
    assert len(rows(db, bid)) == 2 and sum(r.enabled for r in rows(db, bid)) == 1
    # Recompute after preview, rather than trusting stale counts.
    assert (
        upload(client, headers, path, [added], mode="replace", dry_run=False).json()[
            "disabled"
        ]
        == 0
    )
    # PATCH of another field does not revalidate the stored empty source.
    target = next(r for r in rows(db, bid) if r.enabled)
    response = client.patch(
        f"{API}/compliance-rules/{target.id}",
        headers=headers,
        json={"severity": "block"},
    )
    assert response.status_code == 200 and response.json()["source_name"] == ""
    assert client.post(f"{API}{path}", headers=headers, json=RULE).status_code == 422


@pytest.mark.parametrize("mode", ["merge", "replace"])
@pytest.mark.parametrize("dry_run", [True, False])
@pytest.mark.parametrize(
    "name,content",
    [
        ("a.csv", b""),
        ("a.csv", b"\xef\xbb\xbf"),
        ("a.json", b" \r\n"),
        ("a.csv", b"layer,rule_type,severity,pattern\n"),
        ("a.json", b"[]"),
    ],
)
def test_empty_files_never_disable_or_audit(
    client, db, superuser_token_headers, mode, dry_run, name, content
):
    path, bid = brand_path(client, superuser_token_headers)
    db.add(ComplianceRule(brand_id=bid, **RULE))
    db.commit()
    response = upload(
        client,
        superuser_token_headers,
        path,
        name=name,
        content=content,
        mode=mode,
        dry_run=dry_run,
    )
    assert response.status_code == 422
    error = response.json()["error"]
    assert (
        error["code"] == "VALIDATION_ERROR"
        and error["details"]["reason"] == "empty_file"
    )
    assert error["message"] == "文件里没有规则，未做任何更改"
    assert (
        len(rows(db, bid)) == 1 and rows(db, bid)[0].enabled and audits(db, bid) == []
    )


def test_duplicate_conflict_id_escape_and_error_precedence(
    client, db, superuser_token_headers
):
    headers = superuser_token_headers
    path, bid = brand_path(client, headers)
    a, b = (
        ComplianceRule(brand_id=bid, **RULE),
        ComplianceRule(brand_id=bid, **RULE, enabled=False),
    )
    db.add_all([a, b])
    db.commit()
    aid, bid_rule = a.id, b.id
    for dry_run in (True, False):
        response = upload(client, headers, path, dry_run=dry_run)
        assert response.status_code == 409
        conflict = response.json()["error"]["details"]["conflicts"][0]
        assert set(conflict["rule_ids"]) == {str(aid), str(bid_rule)} and conflict[
            "rows"
        ] == [1]
        assert {key: conflict[key] for key in ("layer", "rule_type", "pattern")} == {
            key: RULE[key] for key in ("layer", "rule_type", "pattern")
        }
        assert audits(db, bid) == []
    for bad in (
        {**RULE, "pattern": " ", "source_name": "bad"},
        {**RULE, "pattern": "other", "id": str(uuid.uuid4())},
    ):
        response = upload(client, headers, path, [RULE, bad], dry_run=False)
        assert (
            response.status_code == 422
            and response.json()["error"]["details"]["errors"][0]["row"] == 2
        )
        assert audits(db, bid) == []
    unrelated = {**RULE, "pattern": "无关词"}
    assert (
        upload(client, headers, path, [unrelated], dry_run=False).json()["created"] == 1
    )
    exact = {**RULE, "id": str(bid_rule)}
    response = upload(client, headers, path, [exact], dry_run=False)
    assert response.status_code == 200 and response.json()["updated"] == 1
    assert all(r.enabled for r in rows(db, bid))
    assert next(r for r in rows(db, bid) if r.id == aid).rule_version == 1
    # A precise ID in replace covers only that record, not its same-key sibling.
    response = upload(client, headers, path, [exact], mode="replace", dry_run=False)
    assert response.json()["unchanged"] == 1 and response.json()["disabled"] == 2
    for invalid in ([RULE, RULE], [exact, {**exact, "pattern": "改名"}]):
        assert upload(client, headers, path, invalid, dry_run=False).status_code == 422


def test_export_roundtrip_scopes_nulls_and_samples(client, db, superuser_token_headers):
    headers = superuser_token_headers
    path, bid = brand_path(client, headers)
    other_path, other = brand_path(client, headers)
    a = ComplianceRule(
        brand_id=bid,
        **RULE,
        source_url="",
        source_clause="",
        region_scope="",
        is_sample=True,
    )
    b = ComplianceRule(brand_id=bid, **{**RULE, "pattern": "停用词"}, enabled=False)
    hidden = ComplianceRule(brand_id=other, **{**RULE, "pattern": "私有词"})
    global_row = ComplianceRule(**{**RULE, "pattern": "全局词"})
    db.add_all([a, b, hidden, global_row])
    db.commit()
    original = {
        r.id: (r.rule_version, r.updated_at, r.enabled, r.is_sample)
        for r in rows(db, bid)
    }
    for format in ("csv", "json"):
        response = client.get(
            f"{API}{path}/export", headers=headers, params={"format": format}
        )
        assert (
            response.status_code == 200
            and "attachment" in response.headers["content-disposition"]
        )
        exported = parse_file(f"a.{format}", response.content)
        assert len(exported) == 2 and all(
            r.pattern not in {"私有词", "全局词"} for r in exported
        )
        assert all(r.source_url is None and r.source_name == "" for r in exported)
        response = upload(
            client,
            headers,
            path,
            name=f"a.{format}",
            content=response.content,
            dry_run=False,
        )
        assert response.json()["unchanged"] == 2 and response.json()["updated"] == 0
        assert {
            r.id: (r.rule_version, r.updated_at, r.enabled, r.is_sample)
            for r in rows(db, bid)
        } == original
        global_export = client.get(
            f"{API}/compliance-rules/export?format={format}", headers=headers
        )
        assert all(
            r.id not in {a.id, b.id, hidden.id}
            for r in parse_file(f"a.{format}", global_export.content)
        )
        template = client.get(
            f"{API}/compliance-rules/import-template?format={format}", headers=headers
        )
        assert template.status_code == 200
        sample = parse_file(f"template.{format}", template.content)[0]
        assert (
            sample.id is None
            and not sample.enabled
            and sample.pattern == "示例，请删除"
        )
    assert client.get(f"{API}{other_path}/export", headers=headers).status_code == 200
    # Editing an existing sample clears its flag, without inventing a source.
    assert (
        upload(
            client, headers, path, [{**RULE, "severity": "block"}], dry_run=False
        ).status_code
        == 200
    )
    assert not next(r for r in rows(db, bid) if r.pattern == RULE["pattern"]).is_sample


def test_roles_cross_brand_and_template_permissions(
    client, db, superuser_token_headers
):
    headers = superuser_token_headers
    path, bid = brand_path(client, headers)
    other_path, other = brand_path(client, headers)
    admin, ah = _make_user(client, db)
    editor, eh = _make_user(client, db)
    _add_member(client, headers, str(bid), admin, "admin")
    _add_member(client, headers, str(bid), editor, "editor")
    alien = ComplianceRule(brand_id=other, **RULE)
    db.add(alien)
    db.commit()
    alien_id = alien.id
    for path_item in (path, "/compliance-rules"):
        assert upload(client, {}, path_item).status_code == 401
        assert client.get(f"{API}{path_item}/export").status_code == 401
    assert client.get(f"{API}/compliance-rules/import-template").status_code == 401
    for role_headers in (ah, eh):
        assert upload(client, role_headers, "/compliance-rules").status_code == 403
        assert (
            client.get(
                f"{API}/compliance-rules/export", headers=role_headers
            ).status_code
            == 403
        )
        assert upload(client, role_headers, other_path).status_code == 403
        assert (
            client.get(f"{API}{other_path}/export", headers=role_headers).status_code
            == 403
        )
    assert upload(client, eh, path, content=b"bad", name="a.exe").status_code == 403
    assert client.get(f"{API}{path}/export", headers=eh).status_code == 403
    assert upload(client, ah, path).status_code == 200
    assert client.get(f"{API}{path}/export", headers=ah).status_code == 200
    assert (
        client.get(f"{API}/compliance-rules/import-template", headers=eh).status_code
        == 403
    )
    assert (
        client.get(f"{API}/compliance-rules/import-template", headers=ah).status_code
        == 200
    )
    for format in ("csv", "json"):
        assert (
            client.get(
                f"{API}/compliance-rules/import-template?format={format}", headers=ah
            ).content
            == client.get(
                f"{API}/compliance-rules/import-template?format={format}",
                headers=headers,
            ).content
        )
    response = upload(client, ah, path, [{**RULE, "id": str(alien_id)}], dry_run=False)
    assert response.status_code == 422 and str(alien_id) not in response.text
    assert rows(db, other)[0].rule_version == 1
    assert (
        upload(client, ah, path, [{**RULE, "brand_id": str(other)}]).status_code == 422
    )
    # Even a platform admin cannot read a brand where it has no membership.
    actor = uuid.UUID(client.get(f"{API}/users/me", headers=headers).json()["id"])
    db.delete(db.get(BrandMember, (other, actor)))
    db.commit()
    assert upload(client, headers, other_path).status_code == 403
    assert client.get(f"{API}{other_path}/export", headers=headers).status_code == 403


def test_file_validation_rows_encoding_and_recovery(
    client, db, superuser_token_headers
):
    headers = superuser_token_headers
    path, bid = brand_path(client, headers)
    for name, body, code in [
        ("a.exe", b"bad", "UNSUPPORTED_FILE_TYPE"),
        ("a.json", b"x" * (MAX_BYTES + 1), "FILE_TOO_LARGE"),
        ("a.json", b"\xff", "PARSE_FAILED"),
        ("a.csv", b'pattern\n"bad', "PARSE_FAILED"),
    ]:
        response = upload(client, headers, path, name=name, content=body, dry_run=False)
        assert response.status_code == 422 and response.json()["error"]["code"] == code
    for invalid in (
        [RULE, {**RULE, "pattern": "(x+)+", "is_regex": True}],
        [{**RULE, "layer": "context"}],
        [{**RULE, "source_name": "x" * 201}],
        [RULE] * 2001,
    ):
        response = upload(client, headers, path, invalid, dry_run=False)
        assert (
            response.status_code == 422
            and response.json()["error"]["details"]["errors"]
        )
    assert rows(db, bid) == [] and audits(db, bid) == []
    text = "layer,rule_type,severity,pattern,enabled\nlexicon,brand_forbidden,warn,中文词,TRUE\n"
    assert (
        upload(
            client,
            headers,
            path,
            name="a.csv",
            content=text.encode("gbk"),
            dry_run=False,
        ).status_code
        == 200
    )
    assert rows(db, bid)[0].pattern == "中文词"
    for query in ({"mode": "bad"}, {"dry_run": "bad"}):
        assert upload(client, headers, path, **query).status_code == 422
    assert (
        client.get(f"{API}{path}/export?format=bad", headers=headers).status_code == 422
    )
    assert (
        client.post(
            f"{API}{path}/import",
            headers=headers,
            files=[("file", ("a.json", b"[]")), ("file", ("b.json", b"[]"))],
        ).status_code
        == 422
    )
    assert (
        client.post(
            f"{API}{path}/import",
            headers=headers,
            files={"file": ("a.json", b"[]")},
            data={"brand_id": str(bid)},
        ).status_code
        == 422
    )


def test_atomic_write_failure_recovers(
    client, db, superuser_token_headers, monkeypatch
):
    headers = superuser_token_headers
    path, bid = brand_path(client, headers)
    actor = uuid.UUID(client.get(f"{API}/users/me", headers=headers).json()["id"])
    original = service.record_audit

    def fail(session, **_kwargs):
        session.flush()  # the row reached PostgreSQL, but the transaction must roll back
        raise RuntimeError("simulated audit failure")

    monkeypatch.setattr(service, "record_audit", fail)
    with Session(engine) as session, pytest.raises(RuntimeError, match="simulated"):
        service.import_rules(
            session=session,
            brand_id=bid,
            user_id=actor,
            filename="a.json",
            content=json.dumps([RULE]).encode(),
            mode="merge",
            dry_run=False,
        )
    assert rows(db, bid) == [] and audits(db, bid) == []
    monkeypatch.setattr(service, "record_audit", original)
    assert upload(client, headers, path, dry_run=False).json()["created"] == 1


def test_scope_lock_serializes_empty_scope_and_replans(
    client, db, superuser_token_headers
):
    headers = superuser_token_headers
    path, bid = brand_path(client, headers)
    other_path, _ = brand_path(client, headers)
    actor = uuid.UUID(client.get(f"{API}/users/me", headers=headers).json()["id"])
    started = threading.Event()
    with Session(engine) as holder, ThreadPoolExecutor(max_workers=1) as pool:
        holder.connection().execute(
            text("SELECT pg_advisory_xact_lock(:k)"), {"k": service.scope_lock_key(bid)}
        )

        def waiting_import():
            with Session(engine) as session:
                session.connection().execute(text("SET LOCAL lock_timeout='5s'"))
                started.set()
                return service.import_rules(
                    session=session,
                    brand_id=bid,
                    user_id=actor,
                    filename="a.json",
                    content=json.dumps([RULE]).encode(),
                    mode="merge",
                    dry_run=False,
                )

        future = pool.submit(waiting_import)
        assert started.wait(2)
        # A second scope can proceed while this scope is locked.
        assert upload(client, headers, other_path, dry_run=False).status_code == 200
        assert not future.done()
        holder.add(ComplianceRule(brand_id=bid, **RULE))
        holder.commit()
        assert future.result(timeout=5)["unchanged"] == 1
    assert len(rows(db, bid)) == 1 and len(audits(db, bid)) == 1


def test_direct_service_validation_and_conflict_release_lock(
    client, db, superuser_token_headers
):
    path, bid = brand_path(client, superuser_token_headers)
    actor = uuid.UUID(
        client.get(f"{API}/users/me", headers=superuser_token_headers).json()["id"]
    )
    db.add_all(
        [ComplianceRule(brand_id=bid, **RULE), ComplianceRule(brand_id=bid, **RULE)]
    )
    db.commit()
    for body, error in [
        (b"[]", InvalidInputError),
        (json.dumps([RULE]).encode(), ConflictError),
    ]:
        with Session(engine) as session, pytest.raises(error):
            service.import_rules(
                session=session,
                brand_id=bid,
                user_id=actor,
                filename="a.json",
                content=body,
                mode="merge",
                dry_run=False,
            )
        with Session(engine) as probe:
            assert (
                probe.connection()
                .execute(
                    text("SELECT pg_try_advisory_xact_lock(:k)"),
                    {"k": service.scope_lock_key(bid)},
                )
                .scalar()
            )
    assert (
        upload(
            client,
            superuser_token_headers,
            path,
            [{**RULE, "pattern": "新内容"}],
            dry_run=False,
        ).status_code
        == 200
    )


def test_global_apply_empty_exports_and_max_rows(client, db, superuser_token_headers):
    headers = superuser_token_headers
    prior_audits = {a.id for a in db.exec(select(AuditLog)).all()}
    unique = {**RULE, "pattern": str(uuid.uuid4()), "id": ""}
    response = upload(client, headers, "/compliance-rules", [unique], dry_run=False)
    assert response.status_code == 200 and response.json()["created"] == 1
    target = next(r for r in rows(db, None) if r.pattern == unique["pattern"])
    assert target.brand_id is None and target.created_by is not None
    global_audit = db.exec(
        select(AuditLog).where(
            AuditLog.action == "compliance.import", AuditLog.brand_id.is_(None)
        )
    ).all()
    added_audits = [a for a in global_audit if a.id not in prior_audits]
    assert len(added_audits) == 1 and added_audits[0].detail["scope"] == "global"
    path, bid = brand_path(client, headers)
    for format in ("csv", "json"):
        response = client.get(f"{API}{path}/export?format={format}", headers=headers)
        assert response.status_code == 200
        assert (
            upload(
                client,
                headers,
                path,
                name=f"a.{format}",
                content=response.content,
                mode="replace",
                dry_run=False,
            ).json()["error"]["details"]["reason"]
            == "empty_file"
        )
    maximum = [{**RULE, "pattern": f"规则{i}"} for i in range(2000)]
    response = upload(client, headers, path, maximum)
    assert response.status_code == 200 and response.json()["created"] == 2000
    assert rows(db, bid) == [] and audits(db, bid) == []


def test_unchanged_disabled_and_updated_nullable_fields(
    client, db, superuser_token_headers
):
    headers = superuser_token_headers
    path, bid = brand_path(client, headers)
    row = ComplianceRule(
        brand_id=bid,
        **RULE,
        enabled=False,
        source_clause="",
        source_url="",
        region_scope="",
        is_sample=True,
    )
    db.add(row)
    db.commit()
    response = upload(
        client, headers, path, [{**RULE, "enabled": False}], dry_run=False
    )
    assert response.json()["unchanged"] == 1
    assert rows(db, bid)[0].is_sample and rows(db, bid)[0].rule_version == 1
    response = upload(
        client,
        headers,
        path,
        [{**RULE, "enabled": False, "suggestion": "人工修改"}],
        dry_run=False,
    )
    assert response.json()["updated"] == 1
    updated = rows(db, bid)[0]
    assert (
        updated.source_url is None
        and updated.source_clause is None
        and updated.region_scope is None
    )
    assert updated.rule_version == 2 and not updated.is_sample

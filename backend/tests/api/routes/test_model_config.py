from fastapi.testclient import TestClient
from sqlmodel import Session, delete, select

from app.core.config import settings
from app.models import AuditLog, ProviderCredential
from app.services import model_catalog, provider_keys

URL = f"{settings.API_V1_STR}/settings/providers"
FAKE_VALUE = "fake-" + "a" * 24  # placeholder, not a real credential


def _reset(db: Session) -> None:
    db.execute(delete(ProviderCredential))
    db.commit()


def test_requires_login_and_platform_admin(
    client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
    assert client.get(URL).status_code == 401
    assert client.get(URL, headers=normal_user_token_headers).status_code == 403
    r = client.put(
        f"{URL}/deepseek",
        headers=normal_user_token_headers,
        json={"api_key": FAKE_VALUE},
    )
    assert r.status_code == 403
    r = client.delete(f"{URL}/deepseek", headers=normal_user_token_headers)
    assert r.status_code == 403


def test_key_is_encrypted_masked_and_used(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    _reset(db)
    r = client.put(
        f"{URL}/deepseek", headers=superuser_token_headers, json={"api_key": FAKE_VALUE}
    )
    assert r.status_code == 200
    body = r.json()
    assert body["key_source"] == "database"
    assert body["key_hint"] == FAKE_VALUE[-4:]
    assert FAKE_VALUE not in r.text
    assert FAKE_VALUE not in client.get(URL, headers=superuser_token_headers).text

    row = db.get(ProviderCredential, "deepseek")
    assert row is not None and row.encrypted_key
    assert FAKE_VALUE not in row.encrypted_key
    assert provider_keys.resolve_key("deepseek") == FAKE_VALUE
    assert any(m.enabled for m in model_catalog.list_models())

    audit = db.exec(
        select(AuditLog).where(AuditLog.action == "settings.provider.update")
    ).all()
    assert audit and all(FAKE_VALUE not in str(a.detail) for a in audit)
    _reset(db)


def test_models_override_and_clear(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    _reset(db)
    r = client.put(
        f"{URL}/deepseek",
        headers=superuser_token_headers,
        json={"models": ["model-a", " model-b "]},
    )
    assert r.status_code == 200
    assert r.json()["models"] == ["model-a", "model-b"]
    assert r.json()["models_source"] == "database"
    assert [m.id for m in model_catalog.list_models()] == ["model-a", "model-b"]

    assert (
        client.delete(f"{URL}/deepseek", headers=superuser_token_headers).status_code
        == 200
    )
    assert [m.id for m in model_catalog.list_models()] == settings.DEEPSEEK_MODELS
    _reset(db)


def test_validation_and_unknown_provider(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    h = superuser_token_headers
    assert client.put(f"{URL}/deepseek", headers=h, json={}).status_code == 422
    assert (
        client.put(f"{URL}/deepseek", headers=h, json={"api_key": "short"}).status_code
        == 422
    )
    assert (
        client.put(f"{URL}/nope", headers=h, json={"api_key": FAKE_VALUE}).status_code
        == 422
    )
    assert (
        client.put(f"{URL}/dashscope", headers=h, json={"models": ["x"]}).status_code
        == 409
    )


def test_undecryptable_key_falls_back_to_env(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    _reset(db)
    db.add(ProviderCredential(provider="deepseek", encrypted_key="not-a-token"))
    db.commit()
    assert provider_keys.resolve_key("deepseek") == settings.DEEPSEEK_API_KEY
    body = client.get(URL, headers=superuser_token_headers).json()
    deepseek = next(p for p in body["items"] if p["provider"] == "deepseek")
    assert deepseek["key_source"] in ("env", "none")
    _reset(db)

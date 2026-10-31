"""The error envelope on the real application (the handlers themselves are tested in tests/core)."""

from fastapi.testclient import TestClient

from app.core.config import settings

API = settings.API_V1_STR


def test_invalid_token_is_a_401_envelope(client: TestClient) -> None:
    r = client.get(f"{API}/users/me", headers={"Authorization": "Bearer not-a-token"})
    assert r.status_code == 401
    error = r.json()["error"]
    assert error["code"] == "UNAUTHENTICATED"
    assert r.headers["www-authenticate"] == "Bearer"
    assert error["request_id"] == r.headers["x-request-id"]


def test_missing_token_is_a_401_envelope(client: TestClient) -> None:
    r = client.get(f"{API}/users/me")
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "UNAUTHENTICATED"


def test_forbidden_is_a_403_envelope(
    client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
    r = client.get(f"{API}/users/", headers=normal_user_token_headers)
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "FORBIDDEN"


def test_validation_error_is_a_422_envelope(client: TestClient) -> None:
    r = client.post(f"{API}/login/access-token")
    assert r.status_code == 422
    error = r.json()["error"]
    assert error["code"] == "VALIDATION_ERROR"
    assert error["details"]["errors"]


def test_successful_responses_carry_a_request_id_too(client: TestClient) -> None:
    r = client.get(f"{API}/utils/health-check/")
    assert r.status_code == 200
    assert r.headers["x-request-id"]

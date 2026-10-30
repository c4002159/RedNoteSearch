"""The unified error envelope. A small throwaway app is used so no database is needed."""

import logging

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.core.errors import REQUEST_ID_HEADER, install_error_handling
from app.services.errors import ConflictError, NotFoundError


def _app() -> FastAPI:
    app = FastAPI()
    install_error_handling(app)

    @app.get("/forbidden")
    def forbidden() -> None:
        raise HTTPException(status_code=403, detail="No access to this brand")

    @app.get("/unauthenticated")
    def unauthenticated() -> None:
        raise HTTPException(
            status_code=401,
            detail="Could not validate credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )

    @app.get("/bad-request")
    def bad_request() -> None:
        raise HTTPException(status_code=400, detail={"field": "x"})

    @app.get("/missing")
    def missing() -> None:
        raise NotFoundError("Brand not found")

    @app.get("/conflict")
    def conflict() -> None:
        raise ConflictError("A brand must keep at least one admin")

    @app.get("/number")
    def number(value: int) -> dict[str, int]:
        return {"value": value}

    @app.get("/boom")
    def boom() -> None:
        raise RuntimeError("secret internal detail")

    return app


@pytest.fixture
def client() -> TestClient:
    return TestClient(_app(), raise_server_exceptions=False)


def _error(response_json: dict) -> dict:  # type: ignore[type-arg]
    assert set(response_json) == {"error"}
    error = response_json["error"]
    assert set(error) == {"code", "message", "details", "request_id"}
    return error  # type: ignore[no-any-return]


def test_http_exception_becomes_an_envelope(client: TestClient) -> None:
    r = client.get("/forbidden")
    assert r.status_code == 403
    error = _error(r.json())
    assert error["code"] == "FORBIDDEN"
    assert error["message"] == "No access to this brand"
    assert error["details"] == {}


def test_unauthenticated_keeps_the_challenge_header(client: TestClient) -> None:
    r = client.get("/unauthenticated")
    assert r.status_code == 401
    assert _error(r.json())["code"] == "UNAUTHENTICATED"
    assert r.headers["www-authenticate"] == "Bearer"


def test_structured_detail_goes_to_details(client: TestClient) -> None:
    r = client.get("/bad-request")
    error = _error(r.json())
    assert error["code"] == "BAD_REQUEST"
    assert error["message"] == "Request failed"
    assert error["details"] == {"detail": {"field": "x"}}


def test_service_errors_map_to_404_and_409(client: TestClient) -> None:
    missing = client.get("/missing")
    assert missing.status_code == 404
    assert _error(missing.json())["code"] == "NOT_FOUND"
    conflict = client.get("/conflict")
    assert conflict.status_code == 409
    error = _error(conflict.json())
    assert error["code"] == "CONFLICT"
    assert error["message"] == "A brand must keep at least one admin"


def test_unknown_route_is_a_404_envelope(client: TestClient) -> None:
    r = client.get("/no-such-route")
    assert r.status_code == 404
    assert _error(r.json())["code"] == "NOT_FOUND"


def test_validation_errors_list_the_fields(client: TestClient) -> None:
    r = client.get("/number", params={"value": "abc"})
    assert r.status_code == 422
    error = _error(r.json())
    assert error["code"] == "VALIDATION_ERROR"
    first = error["details"]["errors"][0]
    assert first["loc"] == ["query", "value"]
    assert set(first) == {"loc", "msg", "type"}


def test_unhandled_exception_hides_the_cause_but_logs_it(
    client: TestClient, caplog: pytest.LogCaptureFixture
) -> None:
    with caplog.at_level(logging.ERROR, logger="app.core.errors"):
        r = client.get("/boom")
    assert r.status_code == 500
    error = _error(r.json())
    assert error["code"] == "INTERNAL_ERROR"
    assert "secret internal detail" not in r.text
    assert "Traceback" not in r.text
    assert error["request_id"] in caplog.text  # the log line carries the request id


def test_request_id_is_generated_and_echoed(client: TestClient) -> None:
    r = client.get("/forbidden")
    assert r.headers[REQUEST_ID_HEADER] == r.json()["error"]["request_id"]
    assert len(r.headers[REQUEST_ID_HEADER]) >= 16


def test_a_sane_client_request_id_is_kept(client: TestClient) -> None:
    r = client.get("/forbidden", headers={REQUEST_ID_HEADER: "req-123.abc"})
    assert r.headers[REQUEST_ID_HEADER] == "req-123.abc"
    assert r.json()["error"]["request_id"] == "req-123.abc"


def test_an_unsafe_client_request_id_is_replaced(client: TestClient) -> None:
    for bad in ("a b", "x" * 65, "<script>"):
        r = client.get("/forbidden", headers={REQUEST_ID_HEADER: bad})
        assert r.headers[REQUEST_ID_HEADER] != bad
        assert r.json()["error"]["request_id"] == r.headers[REQUEST_ID_HEADER]

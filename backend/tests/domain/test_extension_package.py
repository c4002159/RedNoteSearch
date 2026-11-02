from io import BytesIO
from pathlib import Path
from zipfile import ZipFile

import pytest
from fastapi.testclient import TestClient

from app.api.deps import get_current_user
from app.main import app
from app.models import User
from app.services.extension_package import RUNTIME_FILES, extension_package


def test_runtime_whitelist_excludes_tests_and_secret_like_files(tmp_path: Path) -> None:
    for name in RUNTIME_FILES:
        (tmp_path / name).write_text(name, encoding="utf-8")
    (tmp_path / "test").mkdir()
    (tmp_path / "test/private.txt").write_text("not packaged", encoding="utf-8")
    (tmp_path / ".env").write_text("not packaged", encoding="utf-8")
    (tmp_path / "keys.json").write_text("not packaged", encoding="utf-8")
    with ZipFile(BytesIO(extension_package(tmp_path))) as archive:
        assert archive.namelist() == [
            f"results-helper/{name}" for name in RUNTIME_FILES
        ]
        assert archive.read("results-helper/manifest.json") == b"manifest.json"


def test_missing_runtime_is_unavailable(tmp_path: Path) -> None:
    with pytest.raises(OSError):
        extension_package(tmp_path)


def test_actual_package_contains_exact_runtime() -> None:
    with ZipFile(BytesIO(extension_package())) as archive:
        assert len(archive.namelist()) == 4
        assert b'"manifest_version": 3' in archive.read("results-helper/manifest.json")


def test_download_route_authenticated_user_and_unavailable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.api.routes import extension

    with TestClient(app) as client:
        assert client.get("/api/v1/extension/package").status_code == 401
        app.dependency_overrides[get_current_user] = lambda: User(
            email="fixture@example.invalid", is_active=True, is_superuser=False
        )
        try:
            response = client.get("/api/v1/extension/package")
            assert response.status_code == 200
            assert response.headers["content-type"] == "application/zip"
            assert (
                response.headers["content-disposition"]
                == 'attachment; filename="results-helper.zip"'
            )
            assert response.headers["cache-control"] == "no-store"
            with ZipFile(BytesIO(response.content)) as archive:
                assert len(archive.namelist()) == 4

            def fail() -> bytes:
                raise OSError("private path is not returned")

            monkeypatch.setattr(extension, "extension_package", fail)
            failure = client.get("/api/v1/extension/package")
            assert (
                failure.status_code == 503
                and failure.json()["error"]["code"] == "EXTENSION_PACKAGE_UNAVAILABLE"
            )
            assert failure.json()["error"]["request_id"]
            assert "private path" not in failure.text
        finally:
            app.dependency_overrides.pop(get_current_user, None)

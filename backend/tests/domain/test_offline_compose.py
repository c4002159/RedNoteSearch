"""Deployment regression: offline packaging must not change either service's behaviour."""

import json
import os
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).parents[3]


def test_offline_compose_preserves_services_except_app_image() -> None:
    docker = shutil.which("docker")
    if docker is None:
        pytest.skip("Docker Compose CLI is required to normalize deployment files")
    env = {
        **os.environ,
        "APP_TAG": "deadbeef",
        "APP_PORT": "8000",
        "PUBLIC_URL": "http://localhost:8000",
        "SECRET_KEY": "offline-test-only-secret",
        "POSTGRES_PASSWORD": "offline-test-only-password",
        "FIRST_SUPERUSER": "admin@example.com",
        "FIRST_SUPERUSER_PASSWORD": "offline-test-only-password",
        "DEEPSEEK_API_KEY": "",
        "DASHSCOPE_API_KEY": "",
        "OPENAI_API_KEY": "",
    }
    configs = []
    for relative in ("deploy/compose.yml", "deploy/offline/compose.offline.yml"):
        result = subprocess.run(
            [
                docker,
                "compose",
                "-f",
                str(ROOT / relative),
                "config",
                "--format",
                "json",
            ],
            env=env,
            capture_output=True,
            text=True,
            check=True,
            timeout=30,
        )
        configs.append(json.loads(result.stdout))
    source, offline = configs
    assert "build" in source["services"]["app"]
    del source["services"]["app"]["build"]
    source["services"]["app"]["image"] = "rednote-app:deadbeef"
    assert offline == source


def test_customer_entrypoint_encodings_are_portable() -> None:
    for name in ("启动.bat", "停止.bat"):
        content = (ROOT / "deploy/offline" / name).read_bytes()
        content.decode("ascii")
        assert b"chcp 65001" in content
        assert b"\n" not in content.replace(b"\r\n", b"")
    for name in ("启动.sh", "停止.sh"):
        content = (ROOT / "deploy/offline" / name).read_bytes()
        assert content.startswith(b"#!/usr/bin/env bash\n") and b"\r" not in content
    assert (ROOT / "deploy/offline/run.ps1").read_bytes().startswith(b"\xef\xbb\xbf")

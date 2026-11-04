"""Byte-preserving configuration regression without Docker or a database."""

import os
import shutil
import subprocess
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

ROOT = Path(__file__).parents[3]


@pytest.mark.parametrize("eol", [b"\n", b"\r\n"])
def test_shell_launcher_reads_port_from_existing_configuration(
    tmp_path: Path, eol: bytes
) -> None:
    bash = shutil.which("bash")
    if bash is None:
        pytest.skip("Bash is required")
    for name in ("启动.sh", "sync-tag.sh"):
        shutil.copyfile(ROOT / "deploy/offline" / name, tmp_path / name)
    (tmp_path / "VERSION.txt").write_text("APP_TAG=cafebabe\n", newline="\n")
    before = eol.join([b"APP_TAG=deadbeef", b"APP_PORT=8092", b"SECRET_KEY=test-only"])
    (tmp_path / ".env").write_bytes(before)
    binaries = tmp_path / "bin"
    binaries.mkdir()
    commands = {
        "docker": """case "$*" in
info|image\\ inspect*) exit 0 ;;
'compose up --help') echo '--wait --pull'; exit 0 ;;
'compose -f compose.offline.yml up -d --wait --pull never') exit 0 ;;
*) exit 2 ;;
esac
""",
        "nc": "exit 1\n",
        "curl": "printf '%s' '<title>RedNoteSearch</title><div id=\"root\"></div>'\n",
        "open": "exit 0\n",
        "xdg-open": "exit 0\n",
    }
    for name, body in commands.items():
        file = binaries / name
        file.write_text("#!/usr/bin/env bash\n" + body, encoding="utf-8", newline="\n")
        file.chmod(0o700)
    env = dict(os.environ)
    env.pop("APP_PORT", None)
    result = subprocess.run(
        [
            bash,
            "-c",
            'bin="$1"; if command -v cygpath >/dev/null; then bin="$(cygpath -u "$bin")"; fi; '
            'export PATH="$bin:$PATH"; source "$0"',
            (tmp_path / "启动.sh").as_posix(),
            binaries.as_posix(),
        ],
        cwd=tmp_path,
        env=env,
        capture_output=True,
        check=False,
        timeout=15,
    )
    assert result.returncode == 0, result.stderr.decode("utf-8", errors="replace")
    assert b"http://localhost:8092" in result.stdout
    assert (tmp_path / ".env").read_bytes() == before.replace(b"deadbeef", b"cafebabe")


@pytest.mark.parametrize("valid_page", [True, False])
def test_windows_host_login_checks_html_before_reporting_success(
    tmp_path: Path, valid_page: bool
) -> None:
    powershell = shutil.which("powershell.exe")
    if powershell is None:
        pytest.skip("Windows PowerShell 5.1 is required")
    observed: list[tuple[str, str | None]] = []

    class LoginHandler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            observed.append((self.path, self.headers.get("Accept")))
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(
                b'<title>RedNoteSearch</title><div id="root"></div>'
                if valid_page
                else b"Another application"
            )

        def log_message(self, *_: object) -> None:
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), LoginHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        source = (ROOT / "deploy/offline/run.ps1").read_text("utf-8-sig")
        functions = source.split("\ntry {\n    if (-not (Get-Command docker", 1)[0]
        runner = tmp_path / "host-check.ps1"
        proxy_setup = r"""
Add-Type @'
using System;
using System.Net;
public class OfflineUnavailableProxy : IWebProxy {
    public ICredentials Credentials { get; set; }
    public Uri GetProxy(Uri destination) { return new Uri("http://127.0.0.1:9"); }
    public bool IsBypassed(Uri destination) { return false; }
}
'@
$proxy = New-Object OfflineUnavailableProxy
[Net.WebRequest]::DefaultWebProxy = $proxy
$failed = $false
"""
        proxy_check = r"""
} catch { $failed = $true }
if (-not [object]::ReferenceEquals([Net.WebRequest]::DefaultWebProxy, $proxy)) {
    throw "Proxy was not restored"
}
Write-Output "PROXY_RESTORED"
if ($failed) { exit 1 }
"""
        runner.write_text(
            functions
            + proxy_setup
            + f'\ntry {{ Wait-HostLogin "{server.server_port}"\n'
            + proxy_check,
            "utf-8-sig",
        )
        env = dict(os.environ)
        for name in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY"):
            env[name] = "http://127.0.0.1:9"
        env["NO_PROXY"] = ""
        result = subprocess.run(
            [
                powershell,
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                str(runner),
            ],
            capture_output=True,
            env=env,
            timeout=25,
            check=False,
        )
        assert (result.returncode == 0) is valid_page
        assert b"PROXY_RESTORED" in result.stdout
        assert observed == [("/login", "text/html")] * (1 if valid_page else 3)
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


@pytest.mark.parametrize(
    ("encoding", "eol", "bom"),
    [
        ("utf-8", "\n", b""),
        ("utf-8", "\r\n", b"\xef\xbb\xbf"),
        ("utf-16-le", "\r\n", b"\xff\xfe"),
        ("utf-16-be", "\n", b"\xfe\xff"),
        ("utf-32-le", "\r\n", b"\xff\xfe\x00\x00"),
        ("utf-32-be", "\n", b"\x00\x00\xfe\xff"),
        ("cp1252", "\r\n", b""),
    ],
)
def test_windows_tag_sync_preserves_encoding_and_other_bytes(
    tmp_path: Path, encoding: str, eol: str, bom: bytes
) -> None:
    powershell = shutil.which("powershell.exe")
    if powershell is None:
        pytest.skip("Windows PowerShell 5.1 is required")
    source = (ROOT / "deploy/offline/run.ps1").read_text("utf-8-sig")
    # Exercise the production functions without starting Docker or opening a browser.
    functions = source.split("\ntry {\n    if (-not (Get-Command docker", 1)[0]
    runner = tmp_path / "check.ps1"
    runner.write_text(functions + '\nSync-ConfigTag "cafebabe"\n', "utf-8-sig")
    text = eol.join(
        ["# café unchanged", "APP_TAG=deadbeef", 'SECRET_KEY="test-only $ \\ value"']
    )
    config = tmp_path / ".env"
    config.write_bytes(bom + text.encode(encoding))
    subprocess.run(
        [powershell, "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(runner)],
        capture_output=True,
        check=True,
    )
    expected = bom + text.replace("APP_TAG=deadbeef", "APP_TAG=cafebabe").encode(
        encoding
    )
    assert config.read_bytes() == expected
    assert list(tmp_path.glob(".env.*.tmp")) == []


@pytest.mark.parametrize("eol", [b"\n", b"\r\n"])
@pytest.mark.parametrize("bom", [b"", b"\xef\xbb\xbf"])
@pytest.mark.parametrize("final_newline", [True, False])
def test_shell_tag_sync_preserves_every_other_byte(
    tmp_path: Path, eol: bytes, bom: bytes, final_newline: bool
) -> None:
    bash = shutil.which("bash")
    if bash is None:
        pytest.skip("Bash is required for the Unix launcher regression")
    before = (
        bom
        + eol.join(
            [
                b"APP_TAG=deadbeef",
                b"# Comment and quoted values must remain unchanged",
                "SOURCE=中文 café".encode(),
                b'SECRET_KEY="test-only-value $ \\ unchanged"',
                b"APP_PORT=8092",
            ]
        )
        + (eol if final_newline else b"")
    )
    config = tmp_path / ".env"
    config.write_bytes(before)
    command = [
        bash,
        "-c",
        'set -euo pipefail; source "$1"; sync_env_tag "$2"',
        "_",
        (ROOT / "deploy/offline/sync-tag.sh").as_posix(),
        "cafebabe",
    ]
    first = subprocess.run(command, cwd=tmp_path, capture_output=True, check=True)
    expected = before.replace(b"APP_TAG=deadbeef", b"APP_TAG=cafebabe")
    assert config.read_bytes() == expected
    assert b"deadbeef" in first.stdout and b"cafebabe" in first.stdout
    modified = config.stat().st_mtime_ns
    second = subprocess.run(command, cwd=tmp_path, capture_output=True, check=True)
    assert second.stdout == b""
    assert config.read_bytes() == expected
    assert config.stat().st_mtime_ns == modified
    assert list(tmp_path.glob(".env.tmp.*")) == []


def test_shell_tag_sync_adds_missing_tag_without_changing_existing_values(
    tmp_path: Path,
) -> None:
    bash = shutil.which("bash")
    if bash is None:
        pytest.skip("Bash is required for the Unix launcher regression")
    config = tmp_path / ".env"
    config.write_bytes(b"SECRET_KEY=test-only-final-n")
    subprocess.run(
        [
            bash,
            "-c",
            'set -euo pipefail; source "$1"; sync_env_tag deadbeef',
            "_",
            (ROOT / "deploy/offline/sync-tag.sh").as_posix(),
        ],
        cwd=tmp_path,
        capture_output=True,
        check=True,
    )
    assert config.read_bytes() == b"SECRET_KEY=test-only-final-n\nAPP_TAG=deadbeef\n"

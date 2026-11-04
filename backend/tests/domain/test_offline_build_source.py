"""Offline package provenance checks without Docker or image builds."""

import re
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).parents[3]
BUILDER = ROOT / "scripts/build-offline-package.ps1"


def test_builder_copies_checkout_and_checks_commit_before_checksums() -> None:
    source = BUILDER.read_text("utf-8-sig")
    copy_lines = [
        line for line in source.splitlines() if "Copy-Item -LiteralPath" in line
    ]
    assert len(copy_lines) == 1
    assert 'Join-Path $checkout "deploy/offline/$file"' in copy_lines[0]
    assert "$repo" not in copy_lines[0]
    assert "ls-tree -r --name-only $Commit -- deploy/offline/" in source
    assert 'show `"${Commit}:deploy/offline/$file`"' in source
    assert "Compare-Object" in source and "$notPackaged = @()" in source
    assert "包内文件与 main 提交不一致，安装包未完成" in source
    assert "$file.EndsWith('.sh')" in source and "$actual -contains [byte]13" in source
    assert "StandardOutput.BaseStream.CopyTo" in source
    assert source.index(
        "Assert-OfflinePackageFiles $repo $sha $output $files"
    ) < source.index("$sums = foreach")
    assert BUILDER.read_bytes().startswith(b"\xef\xbb\xbf")


@pytest.mark.parametrize(
    "scenario",
    [
        "clean",
        "tampered",
        "shell_crlf",
        "missing",
        "unlisted",
        "extra",
        "excluded",
        "bom_removed",
        "invalid_utf8",
    ],
)
def test_package_functions_use_commit_instead_of_stale_dirty_checkout(
    tmp_path: Path, scenario: str
) -> None:
    powershell = shutil.which("powershell.exe")
    git = shutil.which("git")
    if powershell is None or git is None:
        pytest.skip("Windows PowerShell 5.1 and Git are required")
    repository = tmp_path / "stale repository"
    repository.mkdir()

    def run_git(*args: str) -> str:
        result = subprocess.run(
            [
                git,
                "-c",
                "user.name=Offline Test",
                "-c",
                "user.email=offline@example.invalid",
                *args,
            ],
            cwd=repository,
            capture_output=True,
            text=True,
            check=True,
            timeout=15,
        )
        return result.stdout.strip()

    source = BUILDER.read_text("utf-8-sig")
    files = re.findall(
        r'"([^"\n]+)"',
        source.split("function Get-OfflinePackageFiles", 1)[1].split("\n}", 1)[0],
    )
    run_git("init")
    (repository / ".gitattributes").write_text(
        "*.sh text eol=lf\n*.bat text eol=crlf\n", encoding="utf-8"
    )
    offline = repository / "deploy/offline"
    offline.mkdir(parents=True)
    for file in files:
        content = ("old " + file + "\n").encode()
        if file.endswith(".sh"):
            content = b"#!/usr/bin/env bash\necho old\n"
        elif file.endswith(".bat"):
            content = b"@echo off\r\nrem old\r\n"
        elif file == "run.ps1":
            content = b"\xef\xbb\xbfWrite-Output 'old'\r\n"
        (offline / file).write_bytes(content)
    run_git("add", ".")
    run_git("commit", "-m", "old sources")
    previous = run_git("rev-parse", "HEAD")
    for file in files:
        path = offline / file
        path.write_bytes(path.read_bytes().replace(b"old", b"new"))
    if scenario in {"unlisted", "excluded"}:
        (offline / "internal.txt").write_text("not packaged\n")
    run_git("add", ".")
    run_git("commit", "-m", "main sources")
    commit = run_git("rev-parse", "HEAD")
    run_git("update-ref", "refs/remotes/origin/main", commit)
    checkout = tmp_path / "clean checkout"
    run_git("worktree", "add", "--detach", str(checkout), commit)
    run_git("checkout", "--detach", previous)
    (offline / "run.ps1").write_bytes(b"dirty local source\n")
    output = tmp_path / "output"
    output.mkdir()
    functions = (
        "function Read-PackageGit"
        + source.split("function Read-PackageGit", 1)[1].split(
            "\nSet-Location $repo\n", 1
        )[0]
    )
    command = r"""
$files = Get-OfflinePackageFiles
$excluded = @()
if ($Scenario -eq 'extra') { $files += 'missing.txt' }
if ($Scenario -eq 'excluded') { $excluded = @('internal.txt') }
Assert-OfflineManifest $Repository $Commit $files $excluded
Copy-OfflinePackageFiles $Checkout $Output $files
if ($Scenario -eq 'tampered') { [IO.File]::AppendAllText((Join-Path $Output 'run.ps1'), 'tampered') }
if ($Scenario -eq 'shell_crlf') { [IO.File]::WriteAllBytes((Join-Path $Output 'sync-tag.sh'), [Text.Encoding]::UTF8.GetBytes("#!/usr/bin/env bash`r`necho new`r`n")) }
if ($Scenario -eq 'missing') { Remove-Item -LiteralPath (Join-Path $Output 'run.ps1') }
if ($Scenario -eq 'invalid_utf8') { [IO.File]::WriteAllBytes((Join-Path $Output 'run.ps1'), [byte[]]@(255)) }
if ($Scenario -eq 'bom_removed') {
    $path = Join-Path $Output 'run.ps1'
    [byte[]]$bytes = [IO.File]::ReadAllBytes($path)
    [IO.File]::WriteAllBytes($path, $bytes[3..($bytes.Length - 1)])
}
Assert-OfflinePackageFiles $Repository $Commit $Output $files
Write-Output 'PACKAGE_ASSERTION_PASSED'
"""
    runner = tmp_path / "verify.ps1"
    runner.write_text(
        'param($Repository, $Checkout, $Output, $Commit, $Scenario)\n$ErrorActionPreference = "Stop"\n'
        + "[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)\n"
        + functions
        + "\ntry {\n"
        + command
        + "\n} catch { Write-Output $_.Exception.Message; exit 1 }\n",
        encoding="utf-8-sig",
    )
    result = subprocess.run(
        [
            powershell,
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            str(runner),
            str(repository),
            str(checkout),
            str(output),
            commit,
            scenario,
        ],
        capture_output=True,
        check=False,
        timeout=20,
    )
    success = scenario in {"clean", "excluded"}
    assert (result.returncode == 0) is success, result.stderr.decode(errors="replace")
    assert (b"PACKAGE_ASSERTION_PASSED" in result.stdout) is success
    if not success:
        message = result.stdout.decode("utf-8")
        assert "安装包未完成" in message
        assert ("白名单" in message) is (scenario in {"unlisted", "extra"})
    if success:
        assert (output / "run.ps1").read_bytes().startswith(b"\xef\xbb\xbf")
        assert b"new" in (output / "run.ps1").read_bytes()
        assert b"dirty" not in (output / "run.ps1").read_bytes()
        assert not (output / "internal.txt").exists()
    assert not (output / "SHA256SUMS.txt").exists()
    assert output.exists()  # Failed assertions leave evidence in place.

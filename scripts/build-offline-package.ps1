# Build the image and package files from the same clean origin/main worktree.
param([string]$OutputDirectory = "")

$ErrorActionPreference = "Stop"
Set-StrictMode -Version 2
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $repo "artifacts/offline-package" }
$output = [IO.Path]::GetFullPath($OutputDirectory)
if (Test-Path -LiteralPath $output) {
    if (Get-ChildItem -LiteralPath $output -Force | Select-Object -First 1) { throw "输出目录非空，请选择空目录；不会覆盖客户配置或数据。" }
}
$clock = [Diagnostics.Stopwatch]::StartNew()
$timings = New-Object 'System.Collections.Generic.List[string]'
function Invoke-Docker([string[]]$Arguments) {
    & docker @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Docker 命令失败，安装包尚未完成。" }
}
function Write-Utf8([string]$Path, [string]$Text) {
    [IO.File]::WriteAllText($Path, $Text, (New-Object Text.UTF8Encoding($false)))
}

function Read-PackageGit([string]$Repository, [string]$Arguments) {
    # Read stdout as bytes: Windows PowerShell native pipelines can corrupt UTF-8/BOM.
    $process = New-Object Diagnostics.Process
    $memory = New-Object IO.MemoryStream
    try {
        $process.StartInfo.FileName = (Get-Command git -ErrorAction Stop).Source
        $process.StartInfo.Arguments = "-C `"$Repository`" $Arguments"
        $process.StartInfo.UseShellExecute = $false
        $process.StartInfo.CreateNoWindow = $true
        $process.StartInfo.RedirectStandardOutput = $true
        $process.StartInfo.RedirectStandardError = $true
        [void]$process.Start()
        $process.StandardOutput.BaseStream.CopyTo($memory)
        $errorText = $process.StandardError.ReadToEnd()
        $process.WaitForExit()
        if ($process.ExitCode -ne 0) { throw "无法读取 main 提交，安装包未完成。" }
        return ,$memory.ToArray()
    } finally { $memory.Dispose(); $process.Dispose() }
}

function Get-OfflinePackageFiles {
    return @("启动.bat", "启动.sh", "停止.bat", "停止.sh", "run.ps1", "sync-tag.sh", "compose.offline.yml", "README_安装说明.md")
}

function Assert-OfflineManifest([string]$Repository, [string]$Commit, [string[]]$Files, [string[]]$ExcludedFiles = @()) {
    [byte[]]$tree = Read-PackageGit $Repository "-c core.quotepath=false ls-tree -r --name-only $Commit -- deploy/offline/"
    $tracked = @(([Text.Encoding]::UTF8.GetString($tree) -split "`n") | Where-Object { $_ } | ForEach-Object { $_.TrimEnd([char]13).Substring('deploy/offline/'.Length) })
    $listed = @($Files) + @($ExcludedFiles)
    if ($tracked.Count -eq 0 -or $listed.Count -ne @($listed | Select-Object -Unique).Count) {
        throw "离线文件白名单无效，安装包未完成。"
    }
    $difference = @(Compare-Object -ReferenceObject $tracked -DifferenceObject $listed -CaseSensitive)
    if ($difference.Count -gt 0) {
        $names = ($difference | ForEach-Object { $_.InputObject }) -join '、'
        throw "离线文件白名单与 main 目录不一致（$names）；请明确随包或不随包文件，安装包未完成。"
    }
}

function Copy-OfflinePackageFiles([string]$checkout, [string]$output, [string[]]$files) {
    foreach ($file in $files) { Copy-Item -LiteralPath (Join-Path $checkout "deploy/offline/$file") -Destination (Join-Path $output $file) }
}

function Assert-OfflinePackageFiles([string]$Repository, [string]$Commit, [string]$Output, [string[]]$Files) {
    # Compare with git show at the captured main commit; never trust the working tree.
    $encoding = New-Object Text.UTF8Encoding($false, $true)
    foreach ($file in $Files) {
        [byte[]]$expected = Read-PackageGit $Repository "show `"${Commit}:deploy/offline/$file`""
        $path = Join-Path $Output $file
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
            throw "包内文件与 main 提交不一致，安装包未完成：$file（缺失）；输出目录已保留供排查。"
        }
        try {
            $actual = [IO.File]::ReadAllBytes($path)
            $expectedText = $encoding.GetString($expected).Replace("`r`n", "`n").Replace("`r", "`n")
            $actualText = $encoding.GetString($actual).Replace("`r`n", "`n").Replace("`r", "`n")
        } catch {
            throw "包内文件与 main 提交不一致，安装包未完成：$file（无法读取 UTF-8 内容）；输出目录已保留供排查。"
        }
        if (-not [string]::Equals($expectedText, $actualText, [StringComparison]::Ordinal) -or ($file.EndsWith('.sh') -and $actual -contains [byte]13)) {
            throw "包内文件与 main 提交不一致，安装包未完成：$file；输出目录已保留供排查。"
        }
    }
}

Set-Location $repo
docker info *> $null
if ($LASTEXITCODE -ne 0) { throw "请先打开 Docker Desktop。" }
$os = docker info --format '{{.OSType}}'
if ($os -ne "linux") { throw "请将 Docker Desktop 切换到 Linux 容器模式。" }
git fetch origin
if ($LASTEXITCODE -ne 0) { throw "无法获取最新 main，未开始构建。" }
$sha = (git rev-parse origin/main).Trim()
$tag = (git rev-parse --short=12 origin/main).Trim()
if ($tag -notmatch '^[a-f0-9]{7,40}$') { throw "无法确定 main 提交。" }
$buildRoot = [IO.Path]::GetFullPath((Join-Path $repo ".offline-build"))
$checkout = [IO.Path]::GetFullPath((Join-Path $buildRoot ([guid]::NewGuid().ToString("N"))))
if (-not $checkout.StartsWith($buildRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw "临时构建目录校验失败。" }
[void](New-Item -ItemType Directory -Path $buildRoot -Force)
git worktree add --detach $checkout $sha
if ($LASTEXITCODE -ne 0) { throw "无法创建干净检出。" }
try {
    if (git -C $checkout status --porcelain) { throw "镜像构建检出不是干净状态。" }
    $files = Get-OfflinePackageFiles
    # No tracked offline files are intentionally excluded today; list future exclusions here.
    $notPackaged = @()
    Assert-OfflineManifest $repo $sha $files $notPackaged
    $step = [Diagnostics.Stopwatch]::StartNew()
    Invoke-Docker -Arguments @("build", "--file", (Join-Path $checkout "backend/Dockerfile"), "--tag", "rednote-app:$tag", "--label", "org.opencontainers.image.revision=$sha", "--build-arg", "VITE_API_URL=", $checkout)
    $timings.Add("image_build_seconds=$([math]::Round($step.Elapsed.TotalSeconds, 1))")
    Invoke-Docker -Arguments @("pull", "pgvector/pgvector:pg18")
    [void](New-Item -ItemType Directory -Path (Join-Path $output "images") -Force)
    Copy-OfflinePackageFiles $checkout $output $files
    $step.Restart()
    Invoke-Docker -Arguments @("save", "--output", (Join-Path $output "images/rednote-app.tar"), "rednote-app:$tag")
    $timings.Add("app_save_seconds=$([math]::Round($step.Elapsed.TotalSeconds, 1))")
    $step.Restart()
    Invoke-Docker -Arguments @("save", "--output", (Join-Path $output "images/pgvector.tar"), "pgvector/pgvector:pg18")
    $timings.Add("db_save_seconds=$([math]::Round($step.Elapsed.TotalSeconds, 1))")
    $platform = (docker image inspect "rednote-app:$tag" --format '{{.Os}}/{{.Architecture}}').Trim()
    Write-Utf8 (Join-Path $output "VERSION.txt") "APP_TAG=$tag`nGIT_COMMIT=$sha`nBUILD_DATE=$([DateTimeOffset]::Now.ToString('o'))`nPLATFORM=$platform`n"
    Assert-OfflinePackageFiles $repo $sha $output $files
    $sums = foreach ($file in Get-ChildItem -LiteralPath $output -Recurse -File | Sort-Object FullName) {
        $relative = $file.FullName.Substring($output.Length + 1).Replace('\', '/')
        "$((Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant())  $relative"
    }
    Write-Utf8 (Join-Path $output "SHA256SUMS.txt") (($sums -join "`n") + "`n")
    $bytes = (Get-ChildItem -LiteralPath $output -Recurse -File | Measure-Object Length -Sum).Sum
    Write-Host "安装包已生成：$output"
    Write-Host "应用提交：$tag；大小：$bytes 字节；总耗时：$([math]::Round($clock.Elapsed.TotalSeconds, 1)) 秒"
    $timings | ForEach-Object { Write-Host $_ }
} finally {
    # Remove only this script's verified clean worktree, without force or recursive deletion.
    git worktree remove $checkout
    if ($LASTEXITCODE -ne 0) { Write-Warning "临时检出保留供排查：$checkout" }
}

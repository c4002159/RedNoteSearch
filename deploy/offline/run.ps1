param([ValidateSet("Start", "Stop")][string]$Action = "Start")

$ErrorActionPreference = "Stop"
Set-StrictMode -Version 2
Set-Location $PSScriptRoot

function New-Secret([int]$Length) {
    $alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
    $random = [Security.Cryptography.RandomNumberGenerator]::Create()
    $bytes = New-Object byte[] 128
    $result = New-Object Text.StringBuilder
    try {
        while ($result.Length -lt $Length) {
            $random.GetBytes($bytes)
            foreach ($value in $bytes) {
                # Rejection sampling avoids modulo bias; works on Windows PowerShell 5.1.
                if ($value -lt 248) {
                    [void]$result.Append($alphabet[$value % 62])
                    if ($result.Length -eq $Length) { break }
                }
            }
        }
        return $result.ToString()
    } finally { $random.Dispose() }
}

function Read-Setting([string]$Name) {
    if (Test-Path -LiteralPath ".env") {
        foreach ($line in [IO.File]::ReadAllLines((Join-Path $PSScriptRoot ".env"))) {
            if ($line.StartsWith("$Name=")) { return $line.Substring($Name.Length + 1).Trim() }
        }
    }
    return ""
}

function Test-Image([string]$Name) {
    $previous = $ErrorActionPreference
    try {
        # A missing image is the expected first-install branch, not a terminating error.
        $ErrorActionPreference = "Continue"
        docker image inspect $Name *> $null
        return ($LASTEXITCODE -eq 0)
    } finally { $ErrorActionPreference = $previous }
}

try {
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw "请先安装并打开 Docker Desktop，再重新双击启动。" }
    try {
        docker info *> $null
        if ($LASTEXITCODE -ne 0) { throw "Docker unavailable" }
    } catch { throw "Docker 尚未运行，请打开 Docker Desktop，等它显示运行中后重试。" }
    $help = docker compose up --help 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0 -or $help -notmatch '--wait' -or $help -notmatch '--pull') {
        throw "请更新 Docker Desktop；需要支持等待健康检查和禁止拉取镜像的 Docker Compose。"
    }
    $version = Join-Path $PSScriptRoot "VERSION.txt"
    if (-not (Test-Path -LiteralPath $version)) { throw "缺少 VERSION.txt，请使用完整的离线安装包。" }
    $tagLine = [IO.File]::ReadAllLines($version) | Where-Object { $_ -match '^APP_TAG=[a-f0-9]{7,40}$' } | Select-Object -First 1
    if (-not $tagLine) { throw "安装包版本信息不完整，请联系交付人员。" }
    $env:APP_TAG = $tagLine.Substring(8)

    if ($Action -eq "Stop") {
        if (-not (Test-Path -LiteralPath ".env")) { Write-Host "尚未生成首次配置，无需停止。"; exit 0 }
        docker compose -f compose.offline.yml down
        if ($LASTEXITCODE -ne 0) { throw "停止未完成，请保留窗口中的提示并联系交付人员。" }
        Write-Host "已停止，数据仍保留在本机。"
        exit 0
    }

    foreach ($image in @(@("rednote-app:$env:APP_TAG", "images/rednote-app.tar"), @("pgvector/pgvector:pg18", "images/pgvector.tar"))) {
        if (-not (Test-Image $image[0])) {
            if (-not (Test-Path -LiteralPath $image[1])) { throw "安装包缺少镜像文件，请重新获取完整安装包。" }
            Write-Host "正在导入镜像，首次启动可能需要几分钟……"
            docker load -i $image[1]
            if ($LASTEXITCODE -ne 0) { throw "镜像导入失败，请检查磁盘空间及文件是否完整。" }
            if (-not (Test-Image $image[0])) { throw "镜像版本不匹配，请联系交付人员。" }
        }
    }

    $port = if ($env:APP_PORT) { $env:APP_PORT } else { Read-Setting "APP_PORT" }
    if (-not $port) { $port = "8000" }
    if ($port -notmatch '^[1-9][0-9]{0,4}$' -or [int]$port -gt 65535) { throw "APP_PORT 必须为 1 到 65535 的端口号。" }
    if (-not (Test-Path -LiteralPath ".env")) {
        $password = New-Secret 16
        $lines = @(
            "APP_TAG=$env:APP_TAG",
            "SECRET_KEY=$(New-Secret 48)", "POSTGRES_PASSWORD=$(New-Secret 24)",
            "FIRST_SUPERUSER=admin@example.com", "FIRST_SUPERUSER_PASSWORD=$password",
            "APP_PORT=$port", "PUBLIC_URL=http://localhost:$port"
        )
        $config = Join-Path $PSScriptRoot ".env"
        $stream = [IO.File]::Open($config, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
        try {
            $content = (New-Object Text.UTF8Encoding($false)).GetBytes(($lines -join "`n") + "`n")
            $stream.Write($content, 0, $content.Length)
        } finally { $stream.Dispose() }
        Write-Host "首次配置已生成。管理员账号：admin@example.com"
        Write-Host "管理员密码：$password"
        Write-Host "请现在保存密码；它也保存在本目录的隐藏配置文件 .env 中，请勿分享。"
    }
    Write-Host "正在启动并等待服务就绪……"
    docker compose -f compose.offline.yml up -d --wait --pull never
    if ($LASTEXITCODE -ne 0) { throw "启动未完成。若端口被占用，请按安装说明修改 APP_PORT 后重试。" }
    $url = "http://localhost:$port"
    Write-Host "已启动：$url"
    try { Start-Process $url } catch { Write-Host "请手动在浏览器打开：$url" }
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}

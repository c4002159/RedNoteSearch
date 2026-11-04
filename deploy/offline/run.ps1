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


function Protect-Config([string]$Path) {
    try {
        $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
        $result = & icacls $Path /inheritance:r /grant:r "*${sid}:(F)" "*S-1-5-18:(F)" "*S-1-5-32-544:(F)" 2>&1
        if ($LASTEXITCODE -ne 0) { throw "ACL update failed" }
    } catch {
        Write-Warning "未能限制配置文件权限，请勿共享安装目录，并联系管理员检查文件权限。"
    }
}

function Sync-ConfigTag([string]$Tag) {
    $path = Join-Path $PSScriptRoot ".env"
    if (-not (Test-Path -LiteralPath $path)) { return }
    $bytes = [IO.File]::ReadAllBytes($path)
    # Latin-1 maps every byte unchanged, including legacy non-UTF-8 configuration.
    $encoding = [Text.Encoding]::GetEncoding(28591)
    $skip = 0
    if ($bytes.Length -ge 4 -and $bytes[0] -eq 255 -and $bytes[1] -eq 254 -and $bytes[2] -eq 0 -and $bytes[3] -eq 0) {
        $encoding = [Text.Encoding]::UTF32; $skip = 4
    } elseif ($bytes.Length -ge 4 -and $bytes[0] -eq 0 -and $bytes[1] -eq 0 -and $bytes[2] -eq 254 -and $bytes[3] -eq 255) {
        $encoding = New-Object Text.UTF32Encoding($true, $false); $skip = 4
    } elseif ($bytes.Length -ge 2 -and $bytes[0] -eq 255 -and $bytes[1] -eq 254) {
        $encoding = [Text.Encoding]::Unicode; $skip = 2
    } elseif ($bytes.Length -ge 2 -and $bytes[0] -eq 254 -and $bytes[1] -eq 255) {
        $encoding = [Text.Encoding]::BigEndianUnicode; $skip = 2
    } elseif ($bytes.Length -ge 3 -and $bytes[0] -eq 239 -and $bytes[1] -eq 187 -and $bytes[2] -eq 191) {
        $skip = 3
    }
    $text = $encoding.GetString($bytes, $skip, $bytes.Length - $skip)
    $pattern = '(?m)^APP_TAG=[^\r\n]*'
    $matches = [regex]::Matches($text, $pattern)
    if ($matches.Count -gt 0 -and @($matches | Where-Object { $_.Value -ne "APP_TAG=$Tag" }).Count -eq 0) { return }
    $old = if ($matches.Count -gt 0) { $matches[0].Value.Substring(8) } else { "" }
    if ($matches.Count -gt 0) {
        $updated = [regex]::Replace($text, $pattern, "APP_TAG=$Tag")
    } else {
        $eol = [regex]::Match($text, '\r\n|\n|\r').Value
        if (-not $eol) { $eol = "`n" }
        $separator = if ($text.Length -gt 0 -and $text -notmatch '[\r\n]$') { $eol } else { "" }
        $updated = $text + $separator + "APP_TAG=$Tag" + $eol
    }
    [byte[]]$prefix = @()
    if ($skip -gt 0) { $prefix = $bytes[0..($skip - 1)] }
    $temporary = Join-Path $PSScriptRoot (".env." + [guid]::NewGuid().ToString("N") + ".tmp")
    try {
        [IO.File]::WriteAllBytes($temporary, [byte[]]($prefix + $encoding.GetBytes($updated)))
        Protect-Config $temporary
        [IO.File]::Replace($temporary, $path, [NullString]::Value)
    } finally {
        if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary }
    }
    if ($old -notmatch '^[a-f0-9]{7,40}$') { $old = "未记录" }
    Write-Host "已把版本从 $old 更新为 $Tag"
}

function Test-OwnAppPort([string]$Port) {
    try {
        $ids = @(docker compose -f compose.offline.yml ps --status running -q app 2>$null)
        if ($LASTEXITCODE -ne 0) { return $false }
        foreach ($id in $ids) {
            if ($id -notmatch '^[a-f0-9]{12,64}$') { continue }
            $ports = docker inspect $id --format '{{json .NetworkSettings.Ports}}' 2>$null | ConvertFrom-Json
            if ($LASTEXITCODE -ne 0) { continue }
            $mapping = $ports.PSObject.Properties['8000/tcp']
            if ($mapping -and @($mapping.Value | Where-Object { $_.HostPort -eq $Port }).Count -gt 0) { return $true }
        }
    } catch { return $false }
    return $false
}

function Assert-HostPort([string]$Port) {
    $listener = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Any, [int]$Port)
    try {
        $listener.ExclusiveAddressUse = $true
        $listener.Start()
    } catch {
        if (-not (Test-OwnAppPort $Port)) {
            throw "端口 $Port 已被其他程序占用。请按 README_安装说明.md 的「修改端口」小节修改 APP_PORT 和 PUBLIC_URL 后重试；不会自动停止容器。"
        }
    } finally { $listener.Stop() }
}

function Wait-HostLogin([string]$Port) {
    for ($attempt = 1; $attempt -le 3; $attempt++) {
        try {
            $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$Port/login" -Headers @{ Accept = "text/html" } -TimeoutSec 15
            if ($response.StatusCode -eq 200 -and $response.Content.Contains('id="root"') -and $response.Content.Contains('RedNoteSearch')) { return }
        } catch { }
        if ($attempt -lt 3) { Start-Sleep -Seconds 2 }
    }
    throw "本机无法打开登录页，尚未启动成功。请按 README_安装说明.md 的「修改端口」小节检查 APP_PORT 和 PUBLIC_URL；容器已保留，可查看日志。"
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
    Sync-ConfigTag $env:APP_TAG

    if ($Action -eq "Stop") {
        if (-not (Test-Path -LiteralPath ".env")) { Write-Host "尚未生成首次配置，无需停止。"; exit 0 }
        docker compose -f compose.offline.yml down
        if ($LASTEXITCODE -ne 0) { throw "停止未完成，请保留窗口中的提示并联系交付人员。" }
        Write-Host "已停止，数据仍保留在本机。"
        exit 0
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
        Protect-Config $config
        Write-Host "首次配置已生成。管理员账号：admin@example.com"
        Write-Host "管理员密码：$password"
        Write-Host "请现在保存密码；它也保存在本目录的隐藏配置文件 .env 中，请勿分享。"
    }
    Assert-HostPort $port
    foreach ($image in @(@("rednote-app:$env:APP_TAG", "images/rednote-app.tar"), @("pgvector/pgvector:pg18", "images/pgvector.tar"))) {
        if (-not (Test-Image $image[0])) {
            if (-not (Test-Path -LiteralPath $image[1])) { throw "安装包缺少镜像文件，请重新获取完整安装包。" }
            Write-Host "正在导入镜像，首次启动可能需要几分钟……"
            docker load -i $image[1]
            if ($LASTEXITCODE -ne 0) { throw "镜像导入失败，请检查磁盘空间及文件是否完整。" }
            if (-not (Test-Image $image[0])) { throw "镜像版本不匹配，请联系交付人员。" }
        }
    }

    Write-Host "正在启动并等待服务就绪……"
    docker compose -f compose.offline.yml up -d --wait --pull never
    if ($LASTEXITCODE -ne 0) { throw "启动未完成。请查看容器日志；若端口被占用，请按 README_安装说明.md 的「修改端口」小节修改 APP_PORT 和 PUBLIC_URL 后重试；容器已保留。" }
    Wait-HostLogin $port
    $url = "http://localhost:$port"
    Write-Host "已启动：$url"
    try { Start-Process $url } catch { Write-Host "请手动在浏览器打开：$url" }
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}

# One-command start for Windows (PowerShell): powershell -ExecutionPolicy Bypass -File deploy\start.ps1 [-Demo]
# First run creates deploy\.env with random secrets (it is git-ignored; keep it, it holds the admin password).
param([switch]$Demo)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

docker info *> $null
if ($LASTEXITCODE -ne 0) {
  Write-Host "没有检测到正在运行的 Docker。请先安装并打开 Docker Desktop（https://www.docker.com/products/docker-desktop/），再重新运行。"
  exit 1
}

function New-Secret([int]$length) {
  $chars = [char[]]([char]'a'..[char]'z' + [char]'A'..[char]'Z' + [char]'0'..[char]'9')
  $bytes = New-Object byte[] $length
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  $rng.GetBytes($bytes)
  $rng.Dispose()
  -join ($bytes | ForEach-Object { $chars[$_ % $chars.Length] })
}

if (-not (Test-Path .env)) {
  $adminPassword = New-Secret 16
  $lines = @(
    "# Created by start.ps1. Do not share or commit this file.",
    "SECRET_KEY=$(New-Secret 48)",
    "POSTGRES_PASSWORD=$(New-Secret 24)",
    "FIRST_SUPERUSER=admin@example.com",
    "FIRST_SUPERUSER_PASSWORD=$adminPassword",
    "APP_PORT=8000",
    "# If users reach the system by another address (e.g. https://rednote.company.com), set it here.",
    "# PUBLIC_URL=http://localhost:8000"
  )
  [System.IO.File]::WriteAllLines((Join-Path $PSScriptRoot ".env"), $lines, (New-Object System.Text.UTF8Encoding($false)))
  Write-Host "已生成 deploy\.env。管理员账号：admin@example.com，密码：$adminPassword（也保存在 deploy\.env 里，请妥善保管）"
}

docker compose up -d --build --wait
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

if ($Demo) {
  docker compose exec app python -m app.seed --fake-embeddings
}

$port = ((Get-Content .env | Where-Object { $_ -like "APP_PORT=*" }) -split "=", 2)[1]
if (-not $port) { $port = "8000" }
Write-Host "已启动：http://localhost:$port"

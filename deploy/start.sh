#!/usr/bin/env bash
# One-command start for macOS / Linux. Run from anywhere: bash deploy/start.sh [--demo]
# First run creates deploy/.env with random secrets (it is git-ignored; keep it, it holds the admin password).
set -euo pipefail

cd "$(dirname "$0")"

if ! command -v docker >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
  echo "没有检测到正在运行的 Docker。请先安装并打开 Docker Desktop（https://www.docker.com/products/docker-desktop/），再重新运行。" >&2
  exit 1
fi

random() { LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c "$1"; }

if [ ! -f .env ]; then
  ADMIN_PASSWORD="$(random 16)"
  cat >.env <<EOF
# Created by start.sh. Do not share or commit this file.
SECRET_KEY=$(random 48)
POSTGRES_PASSWORD=$(random 24)
FIRST_SUPERUSER=admin@example.com
FIRST_SUPERUSER_PASSWORD=$ADMIN_PASSWORD
APP_PORT=8000
# If users reach the system by another address (e.g. https://rednote.company.com), set it here.
# PUBLIC_URL=http://localhost:8000
EOF
  chmod 600 .env
  echo "已生成 deploy/.env。管理员账号：admin@example.com，密码：$ADMIN_PASSWORD（也保存在 deploy/.env 里，请妥善保管）"
fi

docker compose up -d --build --wait

if [ "${1:-}" = "--demo" ]; then
  docker compose exec app python -m app.seed --fake-embeddings
fi

PORT="$(grep '^APP_PORT=' .env | cut -d= -f2)"
echo "已启动：http://localhost:${PORT:-8000}"

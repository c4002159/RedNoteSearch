#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if ! command -v docker >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
  echo "请先安装并打开 Docker Desktop，等它显示运行中后重试。" >&2; exit 1
fi
if ! docker compose up --help | grep -q -- '--wait'; then
  echo "请更新 Docker Desktop，需要支持健康检查等待的 Docker Compose。" >&2; exit 1
fi
APP_TAG="$(sed -n 's/^APP_TAG=\([a-f0-9]*\)$/\1/p' VERSION.txt)"
if [[ ! "$APP_TAG" =~ ^[a-f0-9]{7,40}$ ]]; then echo "安装包版本信息不完整。" >&2; exit 1; fi
export APP_TAG
for item in "rednote-app:$APP_TAG|images/rednote-app.tar" "pgvector/pgvector:pg18|images/pgvector.tar"; do
  image="${item%%|*}"; archive="${item#*|}"
  if ! docker image inspect "$image" >/dev/null 2>&1; then
    echo "正在导入镜像，首次启动可能需要几分钟……"
    docker load -i "$archive"
    docker image inspect "$image" >/dev/null
  fi
done
read_setting() { if [[ -f .env ]]; then sed -n "s/^$1=//p" .env; fi; }
port="${APP_PORT:-$(read_setting APP_PORT)}"; port="${port:-8000}"
if [[ ! "$port" =~ ^[1-9][0-9]{0,4}$ ]] || ((10#$port > 65535)); then echo "APP_PORT 必须为 1 到 65535。" >&2; exit 1; fi
random() {
  local value="" byte bytes
  local alphabet='abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  while ((${#value} < $1)); do
    bytes="$(LC_ALL=C od -An -v -N 64 -tu1 /dev/urandom)"
    for byte in $bytes; do
      if ((byte < 248)); then
        value+="${alphabet:$((byte % 62)):1}"
        if ((${#value} == $1)); then break; fi
      fi
    done
  done
  printf '%s' "$value"
}
if [[ ! -e .env ]]; then
  umask 077
  password="$(random 16)"
  (set -C; printf '%s\n' "APP_TAG=$APP_TAG" "SECRET_KEY=$(random 48)" "POSTGRES_PASSWORD=$(random 24)" \
    "FIRST_SUPERUSER=admin@example.com" "FIRST_SUPERUSER_PASSWORD=$password" \
    "APP_PORT=$port" "PUBLIC_URL=http://localhost:$port" >.env)
  echo "管理员账号：admin@example.com"
  printf '管理员密码：%s\n' "$password"
  echo "请保存密码；它也保存在本目录的隐藏配置文件 .env 中，请勿分享。"
fi
docker compose -f compose.offline.yml up -d --wait --pull never
url="http://localhost:$port"
printf '已启动：%s\n' "$url"
if command -v open >/dev/null 2>&1; then open "$url" >/dev/null 2>&1 || true;
elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$url" >/dev/null 2>&1 || true; fi

#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
source ./sync-tag.sh
fail() {
  echo "$1" >&2
  if [[ -t 0 ]]; then read -r -p "按回车关闭窗口……" _ || true; fi
  exit 1
}
if ! command -v docker >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
  echo "请先安装并打开 Docker Desktop，等它显示运行中后重试。" >&2; exit 1
fi
if ! help="$(docker compose up --help 2>&1)"; then
  echo "请更新 Docker Desktop，需要支持健康检查等待和禁止拉取镜像的 Docker Compose。" >&2; exit 1
fi
if ! grep -q -- '--wait' <<<"$help" || ! grep -q -- '--pull' <<<"$help"; then
  echo "请更新 Docker Desktop，需要支持健康检查等待和禁止拉取镜像的 Docker Compose。" >&2; exit 1
fi
APP_TAG="$(sed -n 's/^APP_TAG=\([a-f0-9]*\)$/\1/p' VERSION.txt)"
if [[ ! "$APP_TAG" =~ ^[a-f0-9]{7,40}$ ]]; then echo "安装包版本信息不完整。" >&2; exit 1; fi
export APP_TAG
sync_env_tag "$APP_TAG" || fail "配置版本更新未完成，请保留配置并联系交付人员。"
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
# A running container from this exact Compose project may already own the port.
busy=0
if command -v nc >/dev/null 2>&1; then
  if nc -z -w 2 127.0.0.1 "$port" >/dev/null 2>&1; then busy=1; fi
else
  if probe="$(LC_ALL=C bash -c 'exec 3<>/dev/tcp/127.0.0.1/"$1"' _ "$port" 2>&1)"; then busy=1;
  elif [[ "$probe" == *'No such file or directory'* ]]; then echo "端口检测工具不可用，跳过预检；稍后仍会检查登录页。" >&2; fi
fi
if ((busy)); then
  own=0
  ids="$(docker compose -f compose.offline.yml ps --status running -q app)"
  for id in $ids; do
    [[ "$id" =~ ^[a-f0-9]{12,64}$ ]] || continue
    mapped="$(docker inspect "$id" --format '{{range (index .NetworkSettings.Ports "8000/tcp")}}{{println .HostPort}}{{end}}')"
    if grep -Fxq -- "$port" <<<"$mapped"; then own=1; fi
  done
  if ((own == 0)); then fail "端口 $port 已被其他程序占用。请按 README_安装说明.md 的“修改端口”小节修改 APP_PORT 和 PUBLIC_URL；不会自动停止容器。"; fi
fi
for item in "rednote-app:$APP_TAG|images/rednote-app.tar" "pgvector/pgvector:pg18|images/pgvector.tar"; do
  image="${item%%|*}"; archive="${item#*|}"
  if ! docker image inspect "$image" >/dev/null 2>&1; then
    echo "正在导入镜像，首次启动可能需要几分钟……"
    docker load -i "$archive"
    docker image inspect "$image" >/dev/null
  fi
done
if ! docker compose -f compose.offline.yml up -d --wait --pull never; then
  fail "启动未完成。请查看容器日志；若端口被占用，请按 README_安装说明.md 的“修改端口”小节修改 APP_PORT 和 PUBLIC_URL；容器已保留。"
fi
ready=0
for attempt in 1 2 3; do
  response=""
  if command -v curl >/dev/null 2>&1; then
    response="$(curl -fsS --noproxy 127.0.0.1 -H 'Accept: text/html' --max-time 15 "http://127.0.0.1:$port/login" 2>/dev/null)" || true
  elif command -v wget >/dev/null 2>&1; then
    response="$(wget -qO- --header='Accept: text/html' --no-proxy --timeout=15 --tries=1 "http://127.0.0.1:$port/login" 2>/dev/null)" || true
  else
    fail "需要 curl 或 wget 检查本机登录页，请联系交付人员；容器已保留。"
  fi
  if [[ "$response" == *'id="root"'* && "$response" == *RedNoteSearch* ]]; then ready=1; break; fi
  if ((attempt < 3)); then sleep 2; fi
done
if ((ready == 0)); then fail "本机无法打开登录页，尚未启动成功。请按 README_安装说明.md 的“修改端口”小节检查 APP_PORT 和 PUBLIC_URL；容器已保留。"; fi
url="http://localhost:$port"
printf '已启动：%s\n' "$url"
if command -v open >/dev/null 2>&1; then open "$url" >/dev/null 2>&1 || true;
elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$url" >/dev/null 2>&1 || true; fi

#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
source ./sync-tag.sh
APP_TAG="$(sed -n 's/^APP_TAG=\([a-f0-9]*\)$/\1/p' VERSION.txt)"
if [[ ! "$APP_TAG" =~ ^[a-f0-9]{7,40}$ ]]; then echo "安装包版本信息不完整。" >&2; exit 1; fi
export APP_TAG
sync_env_tag "$APP_TAG" || exit 1
if [[ ! -f .env ]]; then echo "尚未生成首次配置，无需停止。"; exit 0; fi
docker compose -f compose.offline.yml down
echo "已停止，数据仍保留在本机。"

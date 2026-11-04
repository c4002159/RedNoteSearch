#!/usr/bin/env bash
# Sourced by both entrypoints. Preserve unrelated bytes, BOM and line endings.
sync_env_tag() {
  [[ -f .env ]] || return 0
  local tag="$1" line value old="" count=0 changed=0 header
  local bom=$'\xef\xbb\xbf' prefix suffix read_status temp last newline=$'\n' first=1
  header="$(od -An -N4 -tx1 .env)"; header="${header//[[:space:]]/}"
  case "$header" in
    fffe*|feff*|0000feff*)
      echo "配置文件编码不能由此脚本安全更新，请使用 Windows 启动入口或联系交付人员。" >&2
      return 1 ;;
  esac
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line#"$bom"}"
    if [[ "$line" == APP_TAG=* ]]; then
      value="${line#APP_TAG=}"; value="${value%$'\r'}"
      [[ -n "$old" ]] || old="$value"
      count=$((count + 1))
      [[ "$value" == "$tag" ]] || changed=1
    fi
  done < .env
  if ((count > 0 && changed == 0)); then return 0; fi
  temp="$(mktemp "$PWD/.env.tmp.XXXXXX")" || return 1
  if ! {
    while true; do
      line=""; read_status=0
      IFS= read -r line || read_status=$?
      if ((read_status != 0)) && [[ -z "$line" ]]; then break; fi
      prefix=""
      if ((first)); then
        if [[ "$line" == *$'\r' ]]; then newline=$'\r\n'; fi
        if [[ "$line" == "$bom"* ]]; then prefix="$bom"; line="${line#"$bom"}"; fi
        first=0
      fi
      if [[ "$line" == APP_TAG=* ]]; then
        suffix=""; [[ "$line" != *$'\r' ]] || suffix=$'\r'
        printf '%s' "${prefix}APP_TAG=${tag}${suffix}"
      else
        printf '%s' "${prefix}${line}"
      fi
      if ((read_status == 0)); then printf '\n'; else break; fi
    done < .env
    if ((count == 0)); then
      last="$(tail -c 1 .env | od -An -tu1)"; last="${last//[[:space:]]/}"
      if [[ -s .env && "$last" != 10 ]]; then printf '%s' "$newline"; fi
      printf 'APP_TAG=%s%s' "$tag" "$newline"
    fi
  } > "$temp"; then rm -f -- "$temp"; return 1; fi
  if ! mv -f -- "$temp" .env; then rm -f -- "$temp"; return 1; fi
  [[ "$old" =~ ^[a-f0-9]{7,40}$ ]] || old="未记录"
  printf '已把版本从 %s 更新为 %s\n' "$old" "$tag"
}

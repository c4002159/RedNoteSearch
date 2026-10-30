#!/usr/bin/env bash
# Fails if user-facing or backend source contains wording that implies legal approval or verified facts.
# Scans frontend/src (excluding the generated client) and backend/app. Tests and docs are not scanned
# because they may quote the terms as negative examples.
set -euo pipefail
cd "$(dirname "$0")/.."
terms_file="scripts/forbidden-wording.txt"
paths=(frontend/src backend/app)
fail=0
while IFS= read -r term || [[ -n "$term" ]]; do
  term="${term%$'\r'}"
  [[ -z "$term" || "$term" == \#* ]] && continue
  if grep -rnF --exclude-dir=client --exclude-dir=node_modules -- "$term" "${paths[@]}"; then
    echo "::error::Forbidden wording found: ${term}"
    fail=1
  fi
done < "$terms_file"
exit "$fail"

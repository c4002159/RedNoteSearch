#!/usr/bin/env bash
# ADR-002: overall coverage must not fall below the recorded baseline (ratchet);
# the domain layer (backend/app/domain) must stay at or above 90%.
# Until a baseline is recorded in docs/decisions/coverage-baseline.txt, the template default of 90% applies.
set -euo pipefail
baseline_file="../docs/decisions/coverage-baseline.txt"
overall=90
if [[ -f "$baseline_file" ]]; then
  overall="$(tr -d '[:space:]' < "$baseline_file")"
fi
echo "Overall coverage threshold: ${overall}%"
coverage report --fail-under="${overall}"
if [[ -d app/domain ]]; then
  echo "Domain layer threshold: 90%"
  coverage report --include="app/domain/*" --fail-under=90
fi

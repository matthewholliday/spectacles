#!/usr/bin/env bash
# spec-to-code.sh — Generate or update code from a spec.
# Usage: ./spec-to-code.sh <path-to-spec>
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <path-to-spec>" >&2
  exit 1
fi

SPEC_PATH="$1"
PROMPT_FILE="$(dirname "$0")/../prompts/spec-to-code.md"

cat "${PROMPT_FILE}"
echo "${SPEC_PATH}"

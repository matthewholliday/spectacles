#!/usr/bin/env bash
# code-to-spec.sh — Generate or update a spec from source code.
# Usage: ./code-to-spec.sh <path-to-source>
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <path-to-source>" >&2
  exit 1
fi

SOURCE_PATH="$1"
PROMPT_FILE="$(dirname "$0")/../prompts/code-to-spec.md"

cat "${PROMPT_FILE}"
echo "${SOURCE_PATH}"

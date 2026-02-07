#!/usr/bin/env bash
set -euo pipefail

WAIT_SECONDS="${1:-2}"
shift || true

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PYTHON_BIN="$BACKEND_DIR/.venv/bin/python"
PY_SCRIPT="$SCRIPT_DIR/resume_sdk_test.py"

if [[ ! -x "$PYTHON_BIN" ]]; then
  echo "Python venv not found: $PYTHON_BIN" >&2
  exit 1
fi

"$PYTHON_BIN" "$PY_SCRIPT" --wait-seconds "$WAIT_SECONDS" "$@"

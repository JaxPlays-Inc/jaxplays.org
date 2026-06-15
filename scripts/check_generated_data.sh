#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

python3 scripts/build_people_credit_index.py

if ! git diff --exit-code -- data/generated; then
  echo "::error::Generated data is stale. Run python3 scripts/build_people_credit_index.py and commit the updated data/generated files."
  exit 1
fi

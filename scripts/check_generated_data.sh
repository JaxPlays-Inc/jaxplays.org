#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

SITE_ROOT="${SITE_ROOT:-sites/jaxplays}"

python3 scripts/build_people_credit_index.py --root "$SITE_ROOT"

if ! git diff --exit-code -- "$SITE_ROOT/data/generated"; then
  echo "::error::Generated data is stale. Run SITE_ROOT=$SITE_ROOT python3 scripts/build_people_credit_index.py --root $SITE_ROOT and commit the updated data/generated files."
  exit 1
fi

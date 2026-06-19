#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

SITE_ROOT="${SITE_ROOT:-sites/jaxplays}"

python3 scripts/build_people_credit_index.py --root "$SITE_ROOT"
hugo --source "$SITE_ROOT" "$@"

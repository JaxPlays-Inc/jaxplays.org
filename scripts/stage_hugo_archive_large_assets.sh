#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT_ROOT="$ROOT_DIR/sites/jaxplays/public-archive"
STAGE_ROOT="$ROOT_DIR/workers/hugo-archive/.large-assets"

mkdir -p "$STAGE_ROOT"
find "$STAGE_ROOT" -depth -mindepth 1 -delete

count=0
while IFS= read -r -d '' source; do
  relative="${source#"$OUTPUT_ROOT/"}"
  destination="$STAGE_ROOT/$relative"
  mkdir -p "$(dirname "$destination")"
  mv "$source" "$destination"
  count=$((count + 1))
done < <(find "$OUTPUT_ROOT" -type f -size +24M -print0)

printf 'Staged %d oversized archive asset(s) for R2.\n' "$count"

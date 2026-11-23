#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKER_ROOT="$ROOT_DIR/workers/hugo-archive"
STAGE_ROOT="$WORKER_ROOT/.large-assets"
WRANGLER="$WORKER_ROOT/node_modules/.bin/wrangler"
BUCKET="jaxplays-hugo-archive-large-assets"

if [[ ! -x "$WRANGLER" ]]; then
  echo "Run npm ci in workers/hugo-archive before uploading archive assets." >&2
  exit 1
fi

if [[ ! -d "$STAGE_ROOT" ]]; then
  echo "Run scripts/build_hugo_archive.sh before uploading archive assets." >&2
  exit 1
fi

count=0
while IFS= read -r -d '' source; do
  relative="${source#"$STAGE_ROOT/"}"
  content_type="$(file --brief --mime-type "$source")"
  "$WRANGLER" r2 object put "$BUCKET/$relative" \
    --file "$source" \
    --content-type "$content_type" \
    --cache-control 'public, max-age=3600' \
    --remote
  count=$((count + 1))
done < <(find "$STAGE_ROOT" -type f -print0)

printf 'Uploaded %d oversized archive asset(s) to %s.\n' "$count" "$BUCKET"

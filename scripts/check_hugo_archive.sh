#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT_ROOT="$ROOT_DIR/sites/jaxplays/public-archive"

require_text() {
  local file="$1"
  local text="$2"
  grep -Fq "$text" "$file" || {
    printf 'Missing %s in %s\n' "$text" "$file" >&2
    exit 1
  }
}

require_text "$OUTPUT_ROOT/index.html" 'data-hugo-archive-banner'
require_text "$OUTPUT_ROOT/index.html" 'name=robots content="noindex, nofollow"'
require_text "$OUTPUT_ROOT/index.html" 'rel=canonical href=https://jaxplays.org/'
require_text "$OUTPUT_ROOT/robots.txt" 'Disallow: /'
require_text "$OUTPUT_ROOT/apply/production/index.html" 'data-archive-form-notice'
require_text "$OUTPUT_ROOT/apply/production/index.html" 'https://jaxplays.org/apply/production/'

if grep -RIlE \
  --include='*.html' \
  '<form([[:space:]>])|googletagmanager\.com|googlesyndication\.com|securepubads\.g\.doubleclick\.net|navigator\.serviceWorker\.register|formbuilder\.online' \
  "$OUTPUT_ROOT"; then
  echo 'Archive output contains active form, analytics, advertising, or service-worker markup.' >&2
  exit 1
fi

echo "Hugo archive contract verified."

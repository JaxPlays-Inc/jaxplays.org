#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

HUGO_ENV=production scripts/build_site.sh \
  --baseURL "https://hugo.jaxplays.org/" \
  --config "config.yaml,config/archive.yaml" \
  --destination public-archive \
  "$@"

# The theme ships a standalone legacy form-builder tool outside Hugo's template system.
# It remains available in the normal rollback build but must not exist on the frozen archive host.
if [[ -d sites/jaxplays/public-archive/formBuilder ]]; then
  find sites/jaxplays/public-archive/formBuilder -depth -delete
fi

scripts/stage_hugo_archive_large_assets.sh

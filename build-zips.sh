#!/usr/bin/env bash
#
# Build store-submission zips for each browser variant. Each zip contains the
# CONTENTS of a variant folder (manifest.json at the zip root, as the stores
# require), excluding macOS cruft and the browser-generated _metadata/ cache.
# Output lands in dist/ (git-ignored); the zips are never committed.
#
# Usage: ./build-zips.sh

set -euo pipefail
cd "$(dirname "$0")"

OUT_DIR="dist"
mkdir -p "$OUT_DIR"

build() {
  local src="$1" zip_name="$2"
  local out="$OUT_DIR/$zip_name"
  rm -f "$out"
  ( cd "$src" && zip -r -X "../$OUT_DIR/$zip_name" . \
      -x '.DS_Store' '*/.DS_Store' '_metadata/*' >/dev/null )
  # Plain grep (not -q) so it reads all of unzip's output; with `set -o pipefail`
  # a `grep -q` early-exit would SIGPIPE unzip and fail the pipeline spuriously.
  unzip -l "$out" | grep -E ' manifest\.json$' >/dev/null \
    || { echo "ERROR: manifest.json not at zip root in $out" >&2; exit 1; }
  echo "built $out"
}

build ezyzip-extension         ezyzip-chrome-extension.zip
build ezyzip-extension-edge    ezyzip-edge-extension.zip
build ezyzip-extension-firefox ezyzip-firefox-extension.zip

echo "Done — zips in $OUT_DIR/ (manifest.json at each zip root)."

#!/usr/bin/env bash
# Download the public-domain Bible corpora (eBible.org VPL) and OpenBible.info cross references.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="$ROOT/data/bible"
mkdir -p "$DEST"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fetch_vpl() {
  local id="$1"
  if [ -f "$DEST/${id}_vpl.txt" ]; then echo "✓ $id already present"; return; fi
  echo "↓ $id (eBible.org)"
  curl -fsSL --retry 3 -o "$TMP/${id}.zip" "https://ebible.org/Scriptures/${id}_vpl.zip"
  unzip -o -q "$TMP/${id}.zip" "${id}_vpl.txt" -d "$DEST"
}

fetch_vpl engwebp       # World English Bible (public domain)
fetch_vpl eng-kjv2006   # King James Version (public domain outside the UK)
fetch_vpl eng-asv       # American Standard Version 1901 (public domain)

if [ -f "$DEST/cross_references.txt" ]; then
  echo "✓ cross references already present"
else
  echo "↓ OpenBible.info cross references (CC-BY)"
  curl -fsSL --retry 3 -o "$TMP/xref.zip" "https://a.openbible.info/data/cross-references.zip"
  unzip -o -q "$TMP/xref.zip" cross_references.txt -d "$DEST"
fi
ls -lh "$DEST"

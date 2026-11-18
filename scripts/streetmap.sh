#!/usr/bin/env bash
# Download the self-hosted street map for a region into data/streetmap/.
#
#   scripts/streetmap.sh tennessee         a named region (see REGIONS)
#   scripts/streetmap.sh custom W,S,E,N    any bounding box, in degrees
#   scripts/streetmap.sh tennessee --dry-run   show the size only
#
# Map data: the latest daily Protomaps build of OpenStreetMap (ODbL).
# Only the region is transferred (HTTP range requests), not the planet.
# Fonts: protomaps/basemaps-assets (SIL Open Font License).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/data/streetmap"
PMTILES_IMAGE="protomaps/go-pmtiles:v1.31.2"
ASSETS="https://codeload.github.com/protomaps/basemaps-assets/tar.gz/refs/heads/main"
MAXZOOM=15

declare -A REGIONS=(
  [tennessee]="-90.32,34.97,-81.64,36.68"
  [southeast]="-94.7,24.4,-75.4,39.2"
  [conus]="-125.0,24.3,-66.9,49.4"
  [planet]="-180,-85,180,85"
)

name="${1:-}"
if [[ -z "$name" ]]; then
  echo "usage: $0 <${!REGIONS[*]}|custom W,S,E,N> [--dry-run]" >&2
  exit 2
fi
shift
if [[ "$name" == custom ]]; then
  bbox="${1:?custom needs W,S,E,N}"
  shift
else
  bbox="${REGIONS[$name]:-}"
  [[ -n "$bbox" ]] || { echo "unknown region: $name" >&2; exit 2; }
fi
dry=""
[[ "${1:-}" == "--dry-run" ]] && dry="--dry-run"

build="$(curl -fsSL https://build-metadata.protomaps.dev/builds.json |
  python3 -c 'import json,sys; print(json.load(sys.stdin)[-1]["key"])')"
echo "Protomaps build $build, region $name ($bbox), up to zoom $MAXZOOM"

mkdir -p "$OUT"
docker run --rm --user "$(id -u):$(id -g)" -v "$OUT:/out" "$PMTILES_IMAGE" \
  extract "https://build.protomaps.com/$build" /out/region.pmtiles.new \
  --bbox="$bbox" --maxzoom="$MAXZOOM" $dry
[[ -n "$dry" ]] && exit 0
mv "$OUT/region.pmtiles.new" "$OUT/region.pmtiles"
printf '%s\n%s\n%s\n' "$name" "$bbox" "$build" > "$OUT/region.txt"

if [[ ! -d "$OUT/fonts/Noto Sans Regular" ]]; then
  echo "Fetching fonts"
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  curl -fsSL -o "$tmp/assets.tar.gz" "$ASSETS"
  mkdir -p "$OUT/fonts"
  tar xzf "$tmp/assets.tar.gz" -C "$OUT/fonts" --strip-components=2 \
    --wildcards 'basemaps-assets-main/fonts/Noto Sans Regular/*' \
    'basemaps-assets-main/fonts/Noto Sans Medium/*' \
    'basemaps-assets-main/fonts/Noto Sans Italic/*' \
    'basemaps-assets-main/fonts/OFL.txt'
fi

du -sh "$OUT/region.pmtiles"
echo "Done. Restart the tile server: docker compose restart tiles"

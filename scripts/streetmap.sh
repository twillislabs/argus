#!/usr/bin/env bash
# Download the self-hosted street map for a region into data/streetmap/.
#
#   scripts/streetmap.sh southeast         a named region (see REGIONS)
#   scripts/streetmap.sh custom W,S,E,N    any bounding box, in degrees
#   scripts/streetmap.sh custom 'W,S,E,N;W,S,E,N'   several boxes, one map
#   scripts/streetmap.sh southeast --dry-run   show the size only
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
  [southeast]="-94.7,24.4,-75.4,39.2"
  [conus]="-125.0,24.3,-66.9,49.4"
  # The lower 48, Alaska (mainland; the peninsula and Aleutians; the
  # panhandle; the Aleutians west of 180 degrees) and Hawaii, as boxes,
  # so the ocean and Canada between them aren't fetched.
  [us]="-125.0,24.3,-66.9,49.4;-169,58.5,-141,71.6;-180,51,-141,58.5;-141,54.6,-129.9,60.4;172.4,51,180,53.1;-160.6,18.8,-154.7,22.4"
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
# Several boxes (separated by ;) become one GeoJSON MultiPolygon.
area=(--bbox="$bbox")
if [[ "$bbox" == *";"* ]]; then
  python3 - "$bbox" > "$OUT/region.geojson" <<'PY'
import json
import sys

polys = []
for box in sys.argv[1].split(";"):
    w, s, e, n = (float(v) for v in box.split(","))
    polys.append([[[w, s], [e, s], [e, n], [w, n], [w, s]]])
print(json.dumps({"type": "MultiPolygon", "coordinates": polys}))
PY
  area=(--region=/out/region.geojson)
fi
docker run --rm --user "$(id -u):$(id -g)" -v "$OUT:/out" "$PMTILES_IMAGE" \
  extract "https://build.protomaps.com/$build" /out/region.pmtiles.new \
  "${area[@]}" --maxzoom="$MAXZOOM" $dry
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

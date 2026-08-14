#!/usr/bin/env bash
#
# Rebuilds the shipped runtime art in public/assets from the full-resolution
# originals in assets/source.
#
# The originals are ~350-900px painterly renders, but nothing is ever drawn
# larger than ~77px (see BUILDING_DISPLAY_SIZES in src/render/WorldScene.ts) and
# portraits sit in a 44px HUD slot. Shipping the originals meant downloading and
# decoding roughly 75x more pixels than any of them can show. Each family is
# resampled to 2x its real draw size — enough for a retina display, nothing more
# — and encoded as WebP.
#
# WebP only, deliberately: the game needs WebGL and Phaser 4, whose browser
# baseline is well past universal WebP support, so a PNG fallback set would
# double the payload to serve nobody.
#
# Requires: sips (macOS, built in) and cwebp (brew install webp).
#
# Usage: ./scripts/optimize-assets.sh

set -euo pipefail

cd "$(dirname "$0")/.."

SRC="assets/source"
OUT="public/assets"

for tool in sips cwebp; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "error: '$tool' not found. Install it (brew install webp) and retry." >&2
    exit 1
  fi
done

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# family:max-edge-in-px. Each is 2x the largest size the family is ever drawn at.
FAMILIES=(
  "buildings:160"
  "nodes:96"
  "residents:80"
  "portraits:96"
  "tiles:64"
)

encode() {
  local src="$1" dest="$2" max="$3"
  local stage="$TMP/$(basename "${dest%.webp}").png"
  # --resampleHeightWidthMax only ever shrinks toward the bound, preserving aspect.
  sips --resampleHeightWidthMax "$max" "$src" --out "$stage" >/dev/null
  # -q 82 is visually lossless for this painterly art; -alpha_q 100 keeps the
  # cutout edges clean, which matters because every sprite is composited.
  cwebp -quiet -q 82 -alpha_q 100 -m 6 "$stage" -o "$dest"
}

total_before=0
total_after=0

for entry in "${FAMILIES[@]}"; do
  family="${entry%%:*}"
  max="${entry##*:}"
  mkdir -p "$OUT/runtime/$family"
  for src in "$SRC/runtime/$family"/*.png; do
    [ -e "$src" ] || continue
    name="$(basename "$src" .png)"
    dest="$OUT/runtime/$family/$name.webp"
    encode "$src" "$dest" "$max"
    before=$(wc -c <"$src")
    after=$(wc -c <"$dest")
    total_before=$((total_before + before))
    total_after=$((total_after + after))
    printf '  %-34s %6sKB -> %5sKB  (%spx)\n' \
      "$family/$name" "$((before / 1024))" "$((after / 1024))" "$max"
  done
done

# Key art is a CSS background on a 270px-wide card; 640px covers it at 2x.
encode "$SRC/mosslight-key-art.png" "$OUT/mosslight-key-art.webp" 640
before=$(wc -c <"$SRC/mosslight-key-art.png")
after=$(wc -c <"$OUT/mosslight-key-art.webp")
total_before=$((total_before + before))
total_after=$((total_after + after))
printf '  %-34s %6sKB -> %5sKB  (%spx)\n' "mosslight-key-art" \
  "$((before / 1024))" "$((after / 1024))" "640"

# Drop any PNGs left over from the pre-WebP asset set.
find "$OUT" -name '*.png' -delete

echo
printf 'total: %sKB -> %sKB (%s%% smaller)\n' \
  "$((total_before / 1024))" "$((total_after / 1024))" \
  "$(( 100 - (total_after * 100 / total_before) ))"

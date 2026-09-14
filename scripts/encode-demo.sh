#!/usr/bin/env bash
# Encode the homepage demo recording for the web.
#
# scrcpy hands us a variable-frame-rate, anamorphic file: square 1080x1080
# pixels carrying a SAR that stretches them back to the phone's portrait
# shape. Browsers honour the SAR, but VFR makes a <video loop> stutter at the
# wrap, so this bakes both out — square pixels at the real display size, and a
# constant frame rate.
#
# Usage: scripts/encode-demo.sh [source.mp4]
set -euo pipefail

SRC="${1:-$HOME/Downloads/ari-promo.mp4}"
HERE="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$HERE/site/public/video"

# The phone frame in Demo.astro is a 252x538 CSS-pixel screen. This is 2x that,
# rounded to the source's own display aspect (90:197) so nothing is cropped.
W=540
H=1182
FPS=30

mkdir -p "$OUT"
[ -f "$SRC" ] || { echo "no source at $SRC" >&2; exit 1; }

VF="scale=${W}:${H}:flags=lanczos,setsar=1,fps=${FPS}"

echo "==> H.264 (baseline compatibility)"
ffmpeg -y -loglevel error -stats -i "$SRC" \
  -vf "$VF" -an \
  -c:v libx264 -profile:v main -pix_fmt yuv420p \
  -crf 27 -preset slow -g $((FPS * 2)) \
  -movflags +faststart \
  "$OUT/ari-demo.mp4"

echo "==> VP9 (smaller, served first where supported)"
ffmpeg -y -loglevel error -stats -i "$SRC" \
  -vf "$VF" -an \
  -c:v libvpx-vp9 -pix_fmt yuv420p \
  -crf 36 -b:v 0 -row-mt 1 -deadline good -cpu-used 2 -g $((FPS * 2)) \
  "$OUT/ari-demo.webm"

echo "==> poster frame"
# One second in, so it is not whatever black frame the recording opened on.
ffmpeg -y -loglevel error -ss 1 -i "$SRC" -vf "$VF" -frames:v 1 \
  -q:v 6 "$OUT/ari-demo-poster.jpg"

echo
ls -lh "$OUT"

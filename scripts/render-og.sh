#!/usr/bin/env bash
# Render the link-preview images from their HTML sources in scripts/og/.
#
#   site/public/og/ari.jpg          1200x630  og:image / twitter:image
#   site/src/assets/og/skill-card.png 1200x630 background of every skill's card
#   site/public/apple-touch-icon.png 180x180  iMessage and iOS home screen
#
# Run by hand after changing a source, and commit the images. Nothing in CI or
# deploy.sh calls this: the images change about as often as the logo does, and
# a headless browser in the build would be a heavy thing to need for that.
#
# Needs Chrome or Chromium on PATH (or CHROME=/path/to/binary).
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$HERE/scripts/og"
OUT="$HERE/site/public"

CHROME="${CHROME:-$(command -v google-chrome || command -v chromium || command -v chromium-browser || true)}"
[ -n "$CHROME" ] || { echo "render-og: no Chrome/Chromium found; set CHROME=" >&2; exit 1; }

shot() { # <source.html> <out.png> <width> <height>
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
    --allow-file-access-from-files --default-background-color=00000000 \
    --virtual-time-budget=2000 --window-size="$3,$4" --screenshot="$2" "file://$1" 2>/dev/null
  echo "render-og: $2 ($3x$4)"
}

mkdir -p "$OUT/og"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
shot "$SRC/card.html" "$TMP/card.png" 1200 630
# The card is all soft gradients, which PNG stores badly: ~320 KB, over the
# ~300 KB past which WhatsApp drops the preview image. JPEG at q88 is ~70 KB
# and indistinguishable. sharp is already a site dependency.
(cd "$HERE/site" && node -e "require('sharp')(process.argv[1]).jpeg({quality:88,mozjpeg:true,chromaSubsampling:'4:4:4'}).toFile(process.argv[2])" "$TMP/card.png" "$OUT/og/ari.jpg")
echo "render-og: $OUT/og/ari.jpg"
mkdir -p "$HERE/site/src/assets/og"
shot "$SRC/skill.html" "$HERE/site/src/assets/og/skill-card.png" 1200 630
shot "$SRC/icon.html" "$OUT/apple-touch-icon.png" 180 180

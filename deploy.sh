#!/usr/bin/env bash
# Build, assemble, sync to S3, invalidate CloudFront.
set -euo pipefail

BUCKET="${BUCKET:-heyari-dev-static}"      # S3 bucket (eu-west-2)
DIST_ID="${DIST_ID:-E3DZC8ECXAT4FZ}"       # CloudFront distribution id
REGION="eu-west-2"
HERE="$(cd "$(dirname "$0")" && pwd)"

npm --prefix "$HERE" run build
node "$HERE/scripts/assemble.mjs"
DIST="$HERE/dist"

# 1) Fingerprinted, immutable assets — long cache.
aws s3 sync "$DIST/" "s3://$BUCKET/" --region "$REGION" --delete \
  --exclude '*' --include '_astro/*' \
  --cache-control 'public, max-age=31536000, immutable'

# 2) Everything else — short cache (HTML, json, svg, etc.).
aws s3 sync "$DIST/" "s3://$BUCKET/" --region "$REGION" --delete \
  --exclude '_astro/*' \
  --cache-control 'public, max-age=300'

# 3) assetlinks.json MUST be application/json or App Link verification breaks.
aws s3 cp "$DIST/.well-known/assetlinks.json" "s3://$BUCKET/.well-known/assetlinks.json" \
  --region "$REGION" --content-type 'application/json' \
  --cache-control 'public, max-age=300' --metadata-directive REPLACE

aws cloudfront create-invalidation --distribution-id "$DIST_ID" --paths '/*' >/dev/null
echo "Deployed to s3://$BUCKET and invalidated $DIST_ID."

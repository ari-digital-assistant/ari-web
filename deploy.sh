#!/usr/bin/env bash
# Sync the static site to S3 and invalidate CloudFront.
# Fill BUCKET + DIST_ID (env or edit) after the infra exists.
set -euo pipefail

BUCKET="${BUCKET:-heyari-dev-static}"        # S3 bucket (eu-west-2)
DIST_ID="${DIST_ID:-E3DZC8ECXAT4FZ}"         # CloudFront distribution id
REGION="eu-west-2"
HERE="$(cd "$(dirname "$0")" && pwd)"

if [ "$BUCKET" = "FILL_ME" ] || [ "$DIST_ID" = "FILL_ME" ]; then
  echo "Set BUCKET and DIST_ID (env or edit this script) first." >&2
  exit 1
fi

# Upload the web content. Exclude repo/infra/source files that aren't served.
aws s3 sync "$HERE/" "s3://$BUCKET/" --region "$REGION" \
  --exclude '.git/*' --exclude 'deploy.sh' --exclude 'cf-rewrite.js' \
  --exclude 'README.md' --exclude 'LICENSE' --delete \
  --cache-control 'public, max-age=300'

# Force the correct content-type + short cache on assetlinks.json
# (critical: App Link verification fails without application/json).
aws s3 cp "$HERE/.well-known/assetlinks.json" "s3://$BUCKET/.well-known/assetlinks.json" \
  --region "$REGION" --content-type 'application/json' \
  --cache-control 'public, max-age=300' --metadata-directive REPLACE

aws cloudfront create-invalidation --distribution-id "$DIST_ID" --paths '/*' >/dev/null
echo "Deployed to s3://$BUCKET and invalidated $DIST_ID."

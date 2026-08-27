#!/usr/bin/env bash
# Restore a CloudFront distribution config from a backup that
# provision-report-api.sh wrote.
#
# The backups are whole-config snapshots taken immediately before an update, so
# restoring one undoes everything that run changed — including the /api/*
# behaviour and the report-fn origin. Nothing else on the distribution is
# touched, because the snapshot IS everything else.
#
# Usage: ./infra/rollback-distribution.sh infra/backup-distribution-<id>-<ts>.json
set -euo pipefail

BACKUP="${1:-}"
DIST_ID="${DIST_ID:-E3DZC8ECXAT4FZ}"

if [[ -z "$BACKUP" || ! -f "$BACKUP" ]]; then
  echo "usage: $0 <backup-json>" >&2
  echo "available:" >&2
  ls -1 "$(dirname "$0")"/backup-distribution-*.json 2>/dev/null >&2 || echo "  (none)" >&2
  exit 2
fi

CONFIG="$(mktemp)"
python3 -c "import json,sys; json.dump(json.load(open(sys.argv[1]))['DistributionConfig'], open(sys.argv[2],'w'))" \
  "$BACKUP" "$CONFIG"

# The ETag has moved on since the backup was taken, so read the current one
# rather than the one stored alongside the snapshot.
ETAG="$(aws cloudfront get-distribution-config --id "$DIST_ID" --query ETag --output text)"

aws cloudfront update-distribution --id "$DIST_ID" --if-match "$ETAG" \
  --distribution-config "file://$CONFIG" >/dev/null
echo "restored $DIST_ID from $BACKUP"

aws cloudfront create-invalidation --distribution-id "$DIST_ID" --paths '/*' >/dev/null
echo "invalidated; CloudFront takes a few minutes to redeploy"

#!/usr/bin/env bash
# Build, assemble, sync to S3, publish the routing function, invalidate CloudFront.
set -euo pipefail

BUCKET="${BUCKET:-heyari-dev-static}"      # S3 bucket (eu-west-2)
DIST_ID="${DIST_ID:-E3DZC8ECXAT4FZ}"       # CloudFront distribution id
FUNCTION="${FUNCTION:-heyari-rewrite}"     # CloudFront Function (cf-rewrite.js)
REPORT_FN="${REPORT_FN:-heyari-report}"    # /api/report Lambda (functions/report)
BUGREPORT_FN="${BUGREPORT_FN:-heyari-bugreport}"  # /api/bug Lambda (functions/bugreport)
REGION="eu-west-2"
HERE="$(cd "$(dirname "$0")" && pwd)"

npm --prefix "$HERE" run build
node "$HERE/scripts/assemble.mjs"
DIST="$HERE/dist"
ROUTER="$HERE/build/cf-rewrite.js"   # cf-rewrite.js + the prerendered skill ids

# 1) Fingerprinted, immutable assets — long cache. The mirrored registry
#    screenshots belong here too: their paths carry the skill version
#    (screenshots/<skill>-<version>/...), so a new build never changes one, it
#    adds a new path and --delete retires the old.
aws s3 sync "$DIST/" "s3://$BUCKET/" --region "$REGION" --delete \
  --exclude '*' --include '_astro/*' --include 'registry/*' \
  --cache-control 'public, max-age=31536000, immutable'

# 2) Everything else — short cache (HTML, json, svg, etc.).
aws s3 sync "$DIST/" "s3://$BUCKET/" --region "$REGION" --delete \
  --exclude '_astro/*' --exclude 'registry/*' \
  --cache-control 'public, max-age=300'

# 3) assetlinks.json MUST be application/json or App Link verification breaks.
aws s3 cp "$DIST/.well-known/assetlinks.json" "s3://$BUCKET/.well-known/assetlinks.json" \
  --region "$REGION" --content-type 'application/json' \
  --cache-control 'public, max-age=300' --metadata-directive REPLACE

# 4) The CloudFront Function that does the routing. Until this step existed,
#    cf-rewrite.js was committed but never shipped: the /skills/<id> deep-link
#    branch sat in the repo from 2026-07-24 with green unit tests while the LIVE
#    function stayed on its 2026-06-15 version, so every skill detail URL 404'd
#    against the private bucket and came back as a 403. Publishing here means
#    the file in the repo is, by construction, the file serving traffic.
#
#    What gets published is build/cf-rewrite.js — the committed cf-rewrite.js
#    with the list of prerendered skill ids injected by scripts/assemble.mjs
#    (which read them straight out of dist/skills/). The logic is still the
#    reviewed file in the repo; only the id list is derived, and it's derived
#    from the very tree being uploaded in this same run.
#
#    Skipped when they already match, so a routine content deploy doesn't churn
#    a new function version — the list only moves when the skill set does.
#    get-function writes the code to the path given as its positional argument,
#    which is why the redirect looks unusual.
LIVE_FN="$(mktemp)"
trap 'rm -f "$LIVE_FN"' EXIT
FN_ACTION="unchanged"
if aws cloudfront get-function --name "$FUNCTION" --stage LIVE "$LIVE_FN" >/dev/null 2>&1 &&
   cmp -s "$LIVE_FN" "$ROUTER"; then
  echo "CloudFront function $FUNCTION already matches build/cf-rewrite.js — skipping."
else
  FN_ACTION="published"
  echo "Publishing $FUNCTION from build/cf-rewrite.js ..."
  ETAG="$(aws cloudfront describe-function --name "$FUNCTION" --query 'ETag' --output text)"
  # update-function replaces the whole config, so Comment and Runtime have to be
  # restated rather than inherited. The runtime is pinned deliberately: a bump
  # is a language-semantics change and belongs in a reviewed commit, not in
  # whatever AWS defaults to on the day we happen to deploy.
  ETAG="$(aws cloudfront update-function --name "$FUNCTION" --if-match "$ETAG" \
    --function-config Comment='directory index + /skills/<id> deep-links + pretty /docs URLs',Runtime=cloudfront-js-2.0 \
    --function-code "fileb://$ROUTER" --query 'ETag' --output text)"
  aws cloudfront publish-function --name "$FUNCTION" --if-match "$ETAG" >/dev/null
  echo "Published $FUNCTION."
fi

# 5) The /api/report Lambda, for the same reason step 4 publishes the routing
#    function: the handler in the repo should be the handler serving traffic.
#    Unconditional rather than skip-if-unchanged, because a zip embeds build
#    timestamps and so never hashes the same twice — comparing against
#    CodeSha256 would report "changed" on every run anyway, at the cost of an
#    extra API call and a misleading log line.
#
#    Infrastructure is NOT created here. infra/provision-report-api.sh owns the
#    function, the API and the CloudFront wiring; this only ships code onto a
#    function that already exists. If it isn't there yet, say so and carry on —
#    a website deploy should not fail because an unrelated backend is missing.
if aws lambda get-function --function-name "$REPORT_FN" --region "$REGION" >/dev/null 2>&1; then
  ZIP="$("$HERE/scripts/package-report-fn.mjs")"
  aws lambda update-function-code --function-name "$REPORT_FN" --region "$REGION" \
    --zip-file "fileb://$ZIP" >/dev/null
  aws lambda wait function-updated-v2 --function-name "$REPORT_FN" --region "$REGION"
  rm -f "$ZIP"
  echo "Shipped $REPORT_FN."
else
  echo "No $REPORT_FN function in $REGION — skipping (run infra/provision-report-api.sh)."
fi

# 6) The /api/bug Lambda. Same reasoning as step 5, and the same "infrastructure
#    is not created here" rule — infra/provision-bug-api.sh owns the bucket, the
#    table, the function and the API routes.
if aws lambda get-function --function-name "$BUGREPORT_FN" --region "$REGION" >/dev/null 2>&1; then
  ZIP="$("$HERE/scripts/package-bugreport-fn.mjs")"
  aws lambda update-function-code --function-name "$BUGREPORT_FN" --region "$REGION" \
    --zip-file "fileb://$ZIP" >/dev/null
  aws lambda wait function-updated-v2 --function-name "$BUGREPORT_FN" --region "$REGION"
  echo "Shipped $BUGREPORT_FN handler code."
else
  echo "No $BUGREPORT_FN function in $REGION — skipping (run infra/provision-bug-api.sh)."
fi

aws cloudfront create-invalidation --distribution-id "$DIST_ID" --paths '/*' >/dev/null
echo "Deployed to s3://$BUCKET, $FUNCTION $FN_ACTION, and invalidated $DIST_ID."

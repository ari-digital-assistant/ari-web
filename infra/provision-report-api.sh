#!/usr/bin/env bash
# Provision the /api/report backend: IAM role, Lambda, HTTP API, and the
# CloudFront behaviour that puts it on heyari.dev.
#
# Idempotent — every step checks before it creates, so re-running after a
# partial failure finishes the job rather than erroring or duplicating.
#
# This exists as a file for the same reason deploy.sh publishes cf-rewrite.js:
# the routing function was managed by hand once and drifted six weeks behind the
# repo. A Lambda, an HTTP API, a CloudFront origin and three IAM policies is a
# lot more surface to drift than one function.
#
# NOT run by CI. This creates infrastructure; buildspec.yml only ships code.
set -euo pipefail

REGION="eu-west-2"                      # site infra lives here; the CLI default is eu-south-1
FUNCTION_NAME="heyari-report"
ROLE_NAME="heyari-report-lambda"
API_NAME="heyari-report-api"
DIST_ID="${DIST_ID:-E3DZC8ECXAT4FZ}"
REPORT_FROM="${REPORT_FROM:-reports@heyari.dev}"
REPORT_TO="${REPORT_TO:-keith@vassallo.cloud}"
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"

# Managed policies, by their documented ids.
#   CachingDisabled            — an API response must never be cached.
#   AllViewerExceptHostHeader  — forwards everything EXCEPT Host. An
#     execute-api origin matches the Host header against its own domain, so
#     forwarding the viewer's heyari.dev would break it.
CACHE_POLICY_CACHING_DISABLED="4135ea2d-6df8-44a3-9df3-4b5a84be39ad"
ORIGIN_REQUEST_ALL_VIEWER_EXCEPT_HOST="b689b0a8-53d0-40ab-baf2-68738e2966ac"

ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
say() { printf '\n=== %s\n' "$1"; }

say "IAM role $ROLE_NAME"
if aws iam get-role --role-name "$ROLE_NAME" >/dev/null 2>&1; then
  echo "exists"
else
  aws iam create-role --role-name "$ROLE_NAME" \
    --description "Execution role for the heyari.dev content-report Lambda" \
    --assume-role-policy-document '{
      "Version": "2012-10-17",
      "Statement": [{
        "Effect": "Allow",
        "Principal": { "Service": "lambda.amazonaws.com" },
        "Action": "sts:AssumeRole"
      }]
    }' >/dev/null
  echo "created"
  # A brand-new role is not immediately usable by Lambda's CreateFunction.
  echo "waiting for the role to propagate..."
  aws iam wait role-exists --role-name "$ROLE_NAME"
  sleep 10
fi

aws iam attach-role-policy --role-name "$ROLE_NAME" \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
echo "attached AWSLambdaBasicExecutionRole (CloudWatch Logs)"

# Scoped to the two identities involved, so the role cannot mail from — or to —
# anything else the account ever verifies.
#
# BOTH identities are needed, which is not obvious: while SES is in the sandbox
# the recipient is itself a verified identity, and SES authorises ses:SendEmail
# against it as well as against the sender. Granting only the sending domain
# fails with "not authorized ... on resource identity/<recipient>".
#
# The configuration set is needed too, and is even less obvious: an identity can
# carry a DEFAULT configuration set (heyari.dev has one), which SES applies to
# every send whether the caller asks for one or not — and then authorises
# against it. Wildcarded rather than pinned by name on purpose: the name is a
# property of the SES setup, not of this function, and pinning it means this
# policy breaks silently the day somebody changes the default. A configuration
# set only selects delivery-tracking options within this account.
FROM_DOMAIN="${REPORT_FROM#*@}"
aws iam put-role-policy --role-name "$ROLE_NAME" --policy-name ses-send \
  --policy-document "{
    \"Version\": \"2012-10-17\",
    \"Statement\": [{
      \"Effect\": \"Allow\",
      \"Action\": [\"ses:SendEmail\"],
      \"Resource\": [
        \"arn:aws:ses:$REGION:$ACCOUNT:identity/$FROM_DOMAIN\",
        \"arn:aws:ses:$REGION:$ACCOUNT:identity/$REPORT_TO\",
        \"arn:aws:ses:$REGION:$ACCOUNT:configuration-set/*\"
      ]
    }]
  }"
echo "put inline policy ses-send (from $FROM_DOMAIN, to $REPORT_TO)"

say "Lambda $FUNCTION_NAME"
ZIP="$("$ROOT/scripts/package-report-fn.mjs")"
echo "packaged $ZIP"
if aws lambda get-function --function-name "$FUNCTION_NAME" --region "$REGION" >/dev/null 2>&1; then
  aws lambda update-function-code --function-name "$FUNCTION_NAME" --region "$REGION" \
    --zip-file "fileb://$ZIP" >/dev/null
  # A code update leaves the function InProgress, and the configuration update
  # below is refused while it is. Only the create path used to wait, so the
  # very first re-run of this script died on ResourceConflictException.
  aws lambda wait function-updated-v2 --function-name "$FUNCTION_NAME" --region "$REGION"
  echo "updated code"
else
  aws lambda create-function --function-name "$FUNCTION_NAME" --region "$REGION" \
    --runtime nodejs22.x --handler index.handler \
    --role "arn:aws:iam::$ACCOUNT:role/$ROLE_NAME" \
    --zip-file "fileb://$ZIP" \
    --timeout 10 --memory-size 256 \
    --description "Emails an in-app content report from the Ari app" >/dev/null
  aws lambda wait function-active-v2 --function-name "$FUNCTION_NAME" --region "$REGION"
  echo "created"
fi

# The secret CloudFront sends as an origin custom header, and the function
# checks. Reused if one is already set, so re-running does not lock the
# distribution out by rotating it on only one side. Never echoed.
ORIGIN_SECRET="$(aws lambda get-function-configuration --function-name "$FUNCTION_NAME" \
  --region "$REGION" --query 'Environment.Variables.ORIGIN_SECRET' --output text 2>/dev/null || true)"
if [[ "$ORIGIN_SECRET" == "None" || -z "$ORIGIN_SECRET" ]]; then
  ORIGIN_SECRET="$(openssl rand -hex 32)"
  echo "generated a new origin secret"
else
  echo "reusing the existing origin secret"
fi

aws lambda update-function-configuration --function-name "$FUNCTION_NAME" --region "$REGION" \
  --environment "Variables={REPORT_FROM=$REPORT_FROM,REPORT_TO=$REPORT_TO,ORIGIN_SECRET=$ORIGIN_SECRET}" >/dev/null
aws lambda wait function-updated-v2 --function-name "$FUNCTION_NAME" --region "$REGION"
echo "set REPORT_FROM=$REPORT_FROM REPORT_TO=$REPORT_TO"

# Belt and braces behind the origin secret. SES sandbox bounds the damage (it
# can only mail the one verified address, 200/day); this bounds the cost, so a
# burst can't run up a bill.
aws lambda put-function-concurrency --function-name "$FUNCTION_NAME" --region "$REGION" \
  --reserved-concurrent-executions 2 >/dev/null
echo "reserved concurrency 2"

say "HTTP API $API_NAME"
# An API Gateway HTTP API, not a Lambda Function URL. Function URLs refused
# every request on this account in both auth modes — public with
# Principal "*", and AWS_IAM behind a CloudFront OAC — with textbook policies
# and zero invocations reaching the function. Rather than keep diagnosing a
# service that would not answer, this uses the older and far more trodden path.
API_ID="$(aws apigatewayv2 get-apis --region "$REGION" \
  --query "Items[?Name=='$API_NAME'].ApiId | [0]" --output text)"
if [[ "$API_ID" == "None" || -z "$API_ID" ]]; then
  # --target is the quick-create form: it builds the AWS_PROXY integration, a
  # $default route and an auto-deploying $default stage in one call. The stage
  # is $default precisely so there is no /prod prefix for CloudFront to strip.
  API_ID="$(aws apigatewayv2 create-api --region "$REGION" --name "$API_NAME" \
    --protocol-type HTTP \
    --target "arn:aws:lambda:$REGION:$ACCOUNT:function:$FUNCTION_NAME" \
    --query ApiId --output text)"
  echo "created $API_ID"
else
  echo "exists $API_ID"
fi
API_HOST="$API_ID.execute-api.$REGION.amazonaws.com"

# Quick-create adds an invoke permission of its own, but only on first create.
# Restating it keeps a re-run correct after someone has pruned policies.
aws lambda remove-permission --function-name "$FUNCTION_NAME" --region "$REGION" \
  --statement-id AllowApiGateway 2>/dev/null || true
aws lambda add-permission --function-name "$FUNCTION_NAME" --region "$REGION" \
  --statement-id AllowApiGateway --action lambda:InvokeFunction \
  --principal apigateway.amazonaws.com \
  --source-arn "arn:aws:execute-api:$REGION:$ACCOUNT:$API_ID/*/*" >/dev/null
echo "granted invoke to $API_NAME"
echo "https://$API_HOST"

say "CloudFront behaviour /api/*"
CFG="$(mktemp -d)/dist.json"
aws cloudfront get-distribution-config --id "$DIST_ID" > "$CFG"
BACKUP="$HERE/backup-distribution-$DIST_ID-$(date +%Y%m%dT%H%M%S).json"
cp "$CFG" "$BACKUP"
echo "backed up current config to $BACKUP"

ETAG="$(python3 -c "import json;print(json.load(open('$CFG'))['ETag'])")"
NEW="$(mktemp)"
CHANGED="$(ORIGIN_HOST="$API_HOST" \
  CACHE_POLICY="$CACHE_POLICY_CACHING_DISABLED" \
  ORIGIN_REQUEST_POLICY="$ORIGIN_REQUEST_ALL_VIEWER_EXCEPT_HOST" \
  ORIGIN_SECRET="$ORIGIN_SECRET" \
  python3 "$HERE/add-api-behaviour.py" "$CFG" "$NEW")"

if [[ "$CHANGED" == "unchanged" ]]; then
  echo "behaviour already present — skipping"
else
  aws cloudfront update-distribution --id "$DIST_ID" --if-match "$ETAG" \
    --distribution-config "file://$NEW" >/dev/null
  echo "pointed /api/* at $API_HOST"
  echo "rollback config saved at $BACKUP (see infra/rollback-distribution.sh)"
fi

cat <<NOTE

=== One thing this script deliberately does not do
The CodeBuild service role needs these on
  arn:aws:lambda:$REGION:$ACCOUNT:function:$FUNCTION_NAME
so deploy.sh can ship new handler code:
  lambda:UpdateFunctionCode  lambda:GetFunction  lambda:GetFunctionConfiguration
GetFunction is what deploy.sh probes with before shipping, and the wait after an
update reads GetFunctionConfiguration — grant only UpdateFunctionCode and the
deploy fails on the guard rather than on the upload. That role is shared with
the site deploy, so widening it is a decision rather than a step:

  aws iam put-role-policy --role-name codebuild-ari-website-service-role \
    --policy-name report-fn-deploy --policy-document '{"Version":"2012-10-17",
      "Statement":[{"Effect":"Allow","Action":["lambda:UpdateFunctionCode",
        "lambda:GetFunction","lambda:GetFunctionConfiguration"],
      "Resource":"arn:aws:lambda:$REGION:$ACCOUNT:function:$FUNCTION_NAME"}]}'
NOTE

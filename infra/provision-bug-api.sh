#!/usr/bin/env bash
# Provision the /api/bug backend: S3 bucket, DynamoDB table, IAM role, Lambda,
# and three routes on the HTTP API that already fronts /api/*.
#
# Idempotent — every step checks before it creates, so re-running after a
# partial failure finishes the job rather than erroring or duplicating.
#
# Deliberately does NOT touch CloudFront. provision-report-api.sh already
# pointed /api/* at the heyari-report-api, and an HTTP API matches an explicit
# route ahead of its $default. So POST /api/bug lands on THIS function while
# everything else still lands on the report one, and the distribution — the
# riskiest thing in the account to edit — is left alone.
#
# NOT run by CI. This creates infrastructure; buildspec.yml only ships code.
set -euo pipefail

REGION="eu-west-2"                      # site infra lives here; the CLI default is eu-south-1
FUNCTION_NAME="heyari-bugreport"
ROLE_NAME="heyari-bugreport-lambda"
BUCKET="${BUCKET:-heyari-bug-reports}"
TABLE="${TABLE:-heyari-bug-reports}"
SECRET_ID="${SECRET_ID:-heyari/bugbot}"
REPO="${REPO:-ari-digital-assistant/ari-android}"
REPORTS_BASE_URL="${REPORTS_BASE_URL:-https://heyari.dev/reports}"
SITE_URL="${SITE_URL:-https://heyari.dev}"
API_NAME="heyari-report-api"            # shared with /api/report, on purpose
REPORT_FN="heyari-report"               # where the origin secret already lives
RETENTION_DAYS=90
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"

ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
say() { printf '\n=== %s\n' "$1"; }

say "S3 bucket $BUCKET"
if aws s3api head-bucket --bucket "$BUCKET" --region "$REGION" >/dev/null 2>&1; then
  echo "exists"
else
  aws s3api create-bucket --bucket "$BUCKET" --region "$REGION" \
    --create-bucket-configuration "LocationConstraint=$REGION" >/dev/null
  echo "created"
fi

# Everything in here is somebody's private diagnostic data — screenshots, logs,
# recordings of their voice. Nothing is ever served from the bucket directly;
# the only way in is a pre-signed URL minted by the Lambda.
aws s3api put-public-access-block --bucket "$BUCKET" --region "$REGION" \
  --public-access-block-configuration \
  'BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true'
echo "blocked all public access"

aws s3api put-bucket-encryption --bucket "$BUCKET" --region "$REGION" \
  --server-side-encryption-configuration '{
    "Rules": [{
      "ApplyServerSideEncryptionByDefault": { "SSEAlgorithm": "AES256" },
      "BucketKeyEnabled": true
    }]
  }'
echo "enabled default encryption at rest"

# The retention promise, and the only thing enforcing it. Expiration is
# evaluated on a schedule rather than to the second, so "90 days" is really
# "within a day or so of 90" — which is what the consent text says.
#
# The multipart rule is not housekeeping pedantry: an abandoned upload leaves
# parts that are invisible to a bucket listing and billed forever.
aws s3api put-bucket-lifecycle-configuration --bucket "$BUCKET" --region "$REGION" \
  --lifecycle-configuration "{
    \"Rules\": [
      {
        \"ID\": \"expire-reports\",
        \"Status\": \"Enabled\",
        \"Filter\": { \"Prefix\": \"reports/\" },
        \"Expiration\": { \"Days\": $RETENTION_DAYS }
      },
      {
        \"ID\": \"abort-incomplete-uploads\",
        \"Status\": \"Enabled\",
        \"Filter\": { \"Prefix\": \"\" },
        \"AbortIncompleteMultipartUpload\": { \"DaysAfterInitiation\": 7 }
      }
    ]
  }"
echo "lifecycle: expire reports/ after $RETENTION_DAYS days, abort stale uploads after 7"

say "DynamoDB table $TABLE"
if aws dynamodb describe-table --table-name "$TABLE" --region "$REGION" >/dev/null 2>&1; then
  echo "exists"
else
  # On-demand because the traffic is a handful of reports a day with no shape
  # worth provisioning for. One table holds both the report index and the
  # rate-limit counters, told apart by their pk prefix.
  aws dynamodb create-table --table-name "$TABLE" --region "$REGION" \
    --attribute-definitions AttributeName=pk,AttributeType=S \
    --key-schema AttributeName=pk,KeyType=HASH \
    --billing-mode PAY_PER_REQUEST >/dev/null
  aws dynamodb wait table-exists --table-name "$TABLE" --region "$REGION"
  echo "created"
fi

# Belt to the S3 lifecycle's braces. DynamoDB's sweep is best-effort and can
# lag up to 48 hours, which is fine: S3 holds the data that matters, and these
# records are an index to it.
TTL_STATUS="$(aws dynamodb describe-time-to-live --table-name "$TABLE" --region "$REGION" \
  --query 'TimeToLiveDescription.TimeToLiveStatus' --output text)"
if [[ "$TTL_STATUS" == "ENABLED" || "$TTL_STATUS" == "ENABLING" ]]; then
  echo "TTL already $TTL_STATUS"
else
  aws dynamodb update-time-to-live --table-name "$TABLE" --region "$REGION" \
    --time-to-live-specification 'Enabled=true,AttributeName=expires' >/dev/null
  echo "enabled TTL on 'expires'"
fi

say "IAM role $ROLE_NAME"
if aws iam get-role --role-name "$ROLE_NAME" >/dev/null 2>&1; then
  echo "exists"
else
  aws iam create-role --role-name "$ROLE_NAME" \
    --description "Execution role for the heyari.dev in-app bug report Lambda" \
    --assume-role-policy-document '{
      "Version": "2012-10-17",
      "Statement": [{
        "Effect": "Allow",
        "Principal": { "Service": "lambda.amazonaws.com" },
        "Action": "sts:AssumeRole"
      }]
    }' >/dev/null
  echo "created"
  echo "waiting for the role to propagate..."
  aws iam wait role-exists --role-name "$ROLE_NAME"
  sleep 10
fi

aws iam attach-role-policy --role-name "$ROLE_NAME" \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
echo "attached AWSLambdaBasicExecutionRole (CloudWatch Logs)"

# Scoped to the three resources this function actually touches, and to the one
# prefix inside the bucket: no s3 access outside reports/*, one table, one
# secret. Scan is here for the maintainer's report list — the table has no
# index to query by date, and at a handful of reports a day building one would
# cost more thought than the scan costs money.
aws iam put-role-policy --role-name "$ROLE_NAME" --policy-name bugreport-access \
  --policy-document "{
    \"Version\": \"2012-10-17\",
    \"Statement\": [
      {
        \"Effect\": \"Allow\",
        \"Action\": [\"s3:PutObject\", \"s3:GetObject\", \"s3:DeleteObject\"],
        \"Resource\": \"arn:aws:s3:::$BUCKET/reports/*\"
      },
      {
        \"Effect\": \"Allow\",
        \"Action\": [\"s3:ListBucket\"],
        \"Resource\": \"arn:aws:s3:::$BUCKET\",
        \"Condition\": { \"StringLike\": { \"s3:prefix\": \"reports/*\" } }
      },
      {
        \"Effect\": \"Allow\",
        \"Action\": [
          \"dynamodb:GetItem\", \"dynamodb:PutItem\",
          \"dynamodb:UpdateItem\", \"dynamodb:DeleteItem\",
          \"dynamodb:Scan\"
        ],
        \"Resource\": \"arn:aws:dynamodb:$REGION:$ACCOUNT:table/$TABLE\"
      },
      {
        \"Effect\": \"Allow\",
        \"Action\": [\"secretsmanager:GetSecretValue\"],
        \"Resource\": \"arn:aws:secretsmanager:$REGION:$ACCOUNT:secret:$SECRET_ID-*\"
      }
    ]
  }"
echo "put inline policy bugreport-access"

say "origin secret"
# Read from the report function rather than generated. CloudFront sends ONE
# header value to the shared origin; minting a second one here would make this
# function reject everything CloudFront forwards to it.
ORIGIN_SECRET="$(aws lambda get-function-configuration --function-name "$REPORT_FN" \
  --region "$REGION" --query 'Environment.Variables.ORIGIN_SECRET' --output text 2>/dev/null || true)"
if [[ "$ORIGIN_SECRET" == "None" || -z "$ORIGIN_SECRET" ]]; then
  echo "ERROR: no ORIGIN_SECRET on $REPORT_FN — run provision-report-api.sh first." >&2
  exit 1
fi
echo "reusing the one CloudFront already sends (never echoed)"

say "session secret"
# Signs the maintainer's session cookie. Generated here and reused on every
# re-run: rotating it would sign everyone out, which is survivable but rude to
# do by accident.
SESSION_SECRET="$(aws lambda get-function-configuration --function-name "$FUNCTION_NAME" \
  --region "$REGION" --query 'Environment.Variables.SESSION_SECRET' --output text 2>/dev/null || true)"
if [[ "$SESSION_SECRET" == "None" || -z "$SESSION_SECRET" ]]; then
  SESSION_SECRET="$(openssl rand -hex 32)"
  echo "generated a new session secret"
else
  echo "reusing the existing session secret"
fi

# The GitHub App's user-authorization credentials, for signing a maintainer in.
# Read from the same secret as the App key rather than passed on a command
# line. Absent until the App has a callback URL and a client secret, in which
# case the reports view simply refuses to sign anyone in — everything the app
# itself does keeps working.
OAUTH_JSON="$(aws secretsmanager get-secret-value --secret-id "$SECRET_ID" --region "$REGION" \
  --query SecretString --output text 2>/dev/null || echo '{}')"
OAUTH_CLIENT_ID="$(printf '%s' "$OAUTH_JSON" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("oauth_client_id",""))' 2>/dev/null || true)"
OAUTH_CLIENT_SECRET="$(printf '%s' "$OAUTH_JSON" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("oauth_client_secret",""))' 2>/dev/null || true)"
if [[ -z "$OAUTH_CLIENT_ID" || -z "$OAUTH_CLIENT_SECRET" ]]; then
  echo "no oauth_client_id/oauth_client_secret in $SECRET_ID — the reports view will not sign anyone in yet"
else
  echo "found the App's user-authorization credentials"
fi

say "Lambda $FUNCTION_NAME"
ZIP="$("$ROOT/scripts/package-bugreport-fn.mjs")"
echo "packaged $ZIP"
if aws lambda get-function --function-name "$FUNCTION_NAME" --region "$REGION" >/dev/null 2>&1; then
  aws lambda update-function-code --function-name "$FUNCTION_NAME" --region "$REGION" \
    --zip-file "fileb://$ZIP" >/dev/null
  aws lambda wait function-updated-v2 --function-name "$FUNCTION_NAME" --region "$REGION"
  echo "updated code"
else
  # 15s and 512 MB: creating an issue is two GitHub round trips after a
  # Secrets Manager read, and a cold start pays for loading the AWS SDK.
  aws lambda create-function --function-name "$FUNCTION_NAME" --region "$REGION" \
    --runtime nodejs22.x --handler index.handler \
    --role "arn:aws:iam::$ACCOUNT:role/$ROLE_NAME" \
    --zip-file "fileb://$ZIP" \
    --timeout 15 --memory-size 512 \
    --description "Files in-app Ari bug reports and holds their attachments privately" >/dev/null
  aws lambda wait function-active-v2 --function-name "$FUNCTION_NAME" --region "$REGION"
  echo "created"
fi

aws lambda update-function-configuration --function-name "$FUNCTION_NAME" --region "$REGION" \
  --environment "Variables={BUCKET=$BUCKET,TABLE=$TABLE,SECRET_ID=$SECRET_ID,REPO=$REPO,REPORTS_BASE_URL=$REPORTS_BASE_URL,SITE_URL=$SITE_URL,ORIGIN_SECRET=$ORIGIN_SECRET,SESSION_SECRET=$SESSION_SECRET,OAUTH_CLIENT_ID=$OAUTH_CLIENT_ID,OAUTH_CLIENT_SECRET=$OAUTH_CLIENT_SECRET}" >/dev/null
aws lambda wait function-updated-v2 --function-name "$FUNCTION_NAME" --region "$REGION"
echo "set BUCKET=$BUCKET TABLE=$TABLE SECRET_ID=$SECRET_ID REPO=$REPO"

# The rate limiter bounds what one install can do; this bounds what the whole
# internet can do if the origin secret ever leaks.
aws lambda put-function-concurrency --function-name "$FUNCTION_NAME" --region "$REGION" \
  --reserved-concurrent-executions 5 >/dev/null
echo "reserved concurrency 5"

say "routes on $API_NAME"
API_ID="$(aws apigatewayv2 get-apis --region "$REGION" \
  --query "Items[?Name=='$API_NAME'].ApiId | [0]" --output text)"
if [[ "$API_ID" == "None" || -z "$API_ID" ]]; then
  echo "ERROR: no $API_NAME — run provision-report-api.sh first." >&2
  exit 1
fi
echo "api $API_ID"

FN_ARN="arn:aws:lambda:$REGION:$ACCOUNT:function:$FUNCTION_NAME"
INTEGRATION_ID="$(aws apigatewayv2 get-integrations --api-id "$API_ID" --region "$REGION" \
  --query "Items[?IntegrationUri=='$FN_ARN'].IntegrationId | [0]" --output text)"
if [[ "$INTEGRATION_ID" == "None" || -z "$INTEGRATION_ID" ]]; then
  INTEGRATION_ID="$(aws apigatewayv2 create-integration --api-id "$API_ID" --region "$REGION" \
    --integration-type AWS_PROXY --integration-uri "$FN_ARN" \
    --payload-format-version 2.0 \
    --query IntegrationId --output text)"
  echo "created integration $INTEGRATION_ID"
else
  echo "integration exists $INTEGRATION_ID"
fi

# Explicit routes beat the API's $default, which is what keeps /api/report on
# the other function while these three come here.
for ROUTE in "POST /api/bug" "POST /api/bug/{id}/finalise" "POST /api/bug/{id}/delete" \
             "GET /api/bug/auth/start" "GET /api/bug/auth/callback" "GET /api/bug/auth/logout" \
             "GET /api/bug/reports" "GET /api/bug/reports/{id}"; do
  EXISTING="$(aws apigatewayv2 get-routes --api-id "$API_ID" --region "$REGION" \
    --query "Items[?RouteKey=='$ROUTE'].RouteId | [0]" --output text)"
  if [[ "$EXISTING" == "None" || -z "$EXISTING" ]]; then
    aws apigatewayv2 create-route --api-id "$API_ID" --region "$REGION" \
      --route-key "$ROUTE" --target "integrations/$INTEGRATION_ID" >/dev/null
    echo "created  $ROUTE"
  else
    aws apigatewayv2 update-route --api-id "$API_ID" --region "$REGION" \
      --route-id "$EXISTING" --target "integrations/$INTEGRATION_ID" >/dev/null
    echo "verified $ROUTE"
  fi
done

aws lambda remove-permission --function-name "$FUNCTION_NAME" --region "$REGION" \
  --statement-id AllowApiGateway 2>/dev/null || true
aws lambda add-permission --function-name "$FUNCTION_NAME" --region "$REGION" \
  --statement-id AllowApiGateway --action lambda:InvokeFunction \
  --principal apigateway.amazonaws.com \
  --source-arn "arn:aws:execute-api:$REGION:$ACCOUNT:$API_ID/*/*" >/dev/null
echo "granted invoke to $API_NAME"

cat <<NOTE

=== Done. The endpoints are live at
  POST https://heyari.dev/api/bug
  POST https://heyari.dev/api/bug/<id>/finalise
  POST https://heyari.dev/api/bug/<id>/delete
  GET  https://heyari.dev/api/bug/auth/start      (maintainer sign-in)
  GET  https://heyari.dev/api/bug/auth/callback
  GET  https://heyari.dev/api/bug/auth/logout
  GET  https://heyari.dev/api/bug/reports         (session required)
  GET  https://heyari.dev/api/bug/reports/<id>

=== Two things this script deliberately does not do

1. CloudFront is untouched. /api/* already points at $API_NAME, and the routes
   above take precedence over its \$default. Nothing to change, nothing to roll
   back.

2. The CodeBuild service role needs these on
     $FN_ARN
   so deploy.sh can ship new handler code:
     lambda:UpdateFunctionCode  lambda:GetFunction  lambda:GetFunctionConfiguration
   That role is shared with the site deploy, so widening it is a decision
   rather than a step:

  aws iam put-role-policy --role-name codebuild-ari-website-service-role \\
    --policy-name bugreport-fn-deploy --policy-document '{"Version":"2012-10-17",
      "Statement":[{"Effect":"Allow","Action":["lambda:UpdateFunctionCode",
        "lambda:GetFunction","lambda:GetFunctionConfiguration"],
      "Resource":"$FN_ARN"}]}'
NOTE

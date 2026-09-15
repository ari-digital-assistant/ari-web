#!/usr/bin/env bash
# Provision the /api/contrib backend: S3 bucket, DynamoDB table, IAM role,
# Lambda, and two routes on the HTTP API that already fronts /api/*.
#
# Idempotent — every step checks before it creates, so re-running after a
# partial failure finishes the job rather than erroring or duplicating.
#
# Deliberately does NOT touch CloudFront. provision-report-api.sh already
# pointed /api/* at the heyari-report-api, and an HTTP API matches an explicit
# route ahead of its $default. So POST /api/contrib lands on THIS function
# while everything else still lands where it did, and the distribution — the
# riskiest thing in the account to edit — is left alone.
#
# A separate bucket from the bug reports on purpose. That bucket expires
# everything at 90 days, which is the promise its consent text makes; this one
# holds a training corpus that is no use if it evaporates. One bucket could not
# honour both, and a lifecycle rule is far too quiet a thing to get wrong.
#
# NOT run by CI. This creates infrastructure; buildspec.yml only ships code.
set -euo pipefail

REGION="eu-west-2"                      # site infra lives here; the CLI default is eu-south-1
FUNCTION_NAME="heyari-contrib"
ROLE_NAME="heyari-contrib-lambda"
BUCKET="${BUCKET:-heyari-contributions}"
TABLE="${TABLE:-heyari-contributions}"
API_NAME="heyari-report-api"            # shared with /api/report and /api/bug, on purpose
REPORT_FN="heyari-report"               # where the origin secret already lives
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

# Everything in here is a recording of somebody's home, contributed on trust.
# Nothing is ever served from the bucket directly; the only way in is a
# pre-signed URL minted by the Lambda, and there is no way out at all except
# through an authenticated operator.
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

# Versioning OFF, deliberately. "Delete my shared data" has to mean the audio
# is gone, and a versioned bucket keeps a copy of every object a delete marker
# hides — a promise the account could not keep.
aws s3api put-bucket-versioning --bucket "$BUCKET" --region "$REGION" \
  --versioning-configuration 'Status=Suspended'
echo "versioning suspended so a deletion is a deletion"

# No expiry rule on contrib/: the corpus is meant to outlive any one release,
# and the privacy notice says so rather than promising a clock it does not run.
# The multipart rule is not housekeeping pedantry: an abandoned upload leaves
# parts that are invisible to a bucket listing and billed forever.
aws s3api put-bucket-lifecycle-configuration --bucket "$BUCKET" --region "$REGION" \
  --lifecycle-configuration '{
    "Rules": [
      {
        "ID": "abort-incomplete-uploads",
        "Status": "Enabled",
        "Filter": { "Prefix": "" },
        "AbortIncompleteMultipartUpload": { "DaysAfterInitiation": 7 }
      }
    ]
  }'
echo "lifecycle: abort stale uploads after 7 days, no expiry on contributions"

say "DynamoDB table $TABLE"
if aws dynamodb describe-table --table-name "$TABLE" --region "$REGION" >/dev/null 2>&1; then
  echo "exists"
else
  # On-demand because the traffic is a handful of batches a day with no shape
  # worth provisioning for. The table holds rate-limit counters and nothing
  # else — the bucket listing is the index of what has been contributed.
  aws dynamodb create-table --table-name "$TABLE" --region "$REGION" \
    --attribute-definitions AttributeName=pk,AttributeType=S \
    --key-schema AttributeName=pk,KeyType=HASH \
    --billing-mode PAY_PER_REQUEST >/dev/null
  aws dynamodb wait table-exists --table-name "$TABLE" --region "$REGION"
  echo "created"
fi

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
    --description "Execution role for the heyari.dev recording contribution Lambda" \
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

# Scoped to the two resources this function touches, and to the one prefix
# inside the bucket. No GetObject: the Lambda signs uploads and erases
# prefixes, and has no business reading anybody's audio back.
aws iam put-role-policy --role-name "$ROLE_NAME" --policy-name contrib-access \
  --policy-document "{
    \"Version\": \"2012-10-17\",
    \"Statement\": [
      {
        \"Effect\": \"Allow\",
        \"Action\": [\"s3:PutObject\", \"s3:DeleteObject\"],
        \"Resource\": \"arn:aws:s3:::$BUCKET/contrib/*\"
      },
      {
        \"Effect\": \"Allow\",
        \"Action\": [\"s3:ListBucket\"],
        \"Resource\": \"arn:aws:s3:::$BUCKET\",
        \"Condition\": { \"StringLike\": { \"s3:prefix\": \"contrib/*\" } }
      },
      {
        \"Effect\": \"Allow\",
        \"Action\": [\"dynamodb:UpdateItem\"],
        \"Resource\": \"arn:aws:dynamodb:$REGION:$ACCOUNT:table/$TABLE\"
      }
    ]
  }"
echo "put inline policy contrib-access"

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

say "Lambda $FUNCTION_NAME"
ZIP="$("$ROOT/scripts/package-contrib-fn.mjs")"
echo "packaged $ZIP"
if aws lambda get-function --function-name "$FUNCTION_NAME" --region "$REGION" >/dev/null 2>&1; then
  aws lambda update-function-code --function-name "$FUNCTION_NAME" --region "$REGION" \
    --zip-file "fileb://$ZIP" >/dev/null
  aws lambda wait function-updated-v2 --function-name "$FUNCTION_NAME" --region "$REGION"
  echo "updated code"
else
  # 30s rather than the bug function's 15: a deletion pages through a prefix
  # that may hold thousands of clips, and each page is a list plus a delete.
  aws lambda create-function --function-name "$FUNCTION_NAME" --region "$REGION" \
    --runtime nodejs22.x --handler index.handler \
    --role "arn:aws:iam::$ACCOUNT:role/$ROLE_NAME" \
    --zip-file "fileb://$ZIP" \
    --timeout 30 --memory-size 512 \
    --description "Signs uploads for contributed Ari recordings and erases them on request" >/dev/null
  aws lambda wait function-active-v2 --function-name "$FUNCTION_NAME" --region "$REGION"
  echo "created"
fi

aws lambda update-function-configuration --function-name "$FUNCTION_NAME" --region "$REGION" \
  --environment "Variables={BUCKET=$BUCKET,TABLE=$TABLE,ORIGIN_SECRET=$ORIGIN_SECRET}" >/dev/null
aws lambda wait function-updated-v2 --function-name "$FUNCTION_NAME" --region "$REGION"
echo "set BUCKET=$BUCKET TABLE=$TABLE"

# The rate limiter bounds what one contributor can do; this bounds what the
# whole internet can do if the origin secret ever leaks.
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

# Explicit routes beat the API's $default, which is what keeps /api/report and
# /api/bug on their own functions while these two come here.
for ROUTE in "POST /api/contrib" "POST /api/contrib/delete"; do
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
  POST https://heyari.dev/api/contrib          (mint pre-signed uploads)
  POST https://heyari.dev/api/contrib/delete   (erase one contributor's prefix)

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
    --policy-name contrib-fn-deploy --policy-document '{"Version":"2012-10-17",
      "Statement":[{"Effect":"Allow","Action":["lambda:UpdateFunctionCode",
        "lambda:GetFunction","lambda:GetFunctionConfiguration"],
      "Resource":"$FN_ARN"}]}'
NOTE

#!/usr/bin/env bash
# Provision the /api/tester backend: IAM role, Lambda, and two routes on the
# HTTP API that already fronts /api/*.
#
# Idempotent — every step checks before it creates, so re-running after a
# partial failure finishes the job rather than erroring or duplicating.
#
# Deliberately does NOT touch CloudFront, for the same reason
# provision-bug-api.sh doesn't: /api/* already points at the heyari-report-api,
# and an HTTP API matches an explicit route ahead of its $default. So
# POST /api/tester and POST /api/tester/challenge land on THIS function while
# everything else still lands where it did, and the distribution is left alone.
#
# NOT run by CI. This creates infrastructure; buildspec.yml only ships code.
set -euo pipefail

REGION="eu-west-2"                      # site infra lives here; the CLI default is eu-south-1
FUNCTION_NAME="heyari-tester"
ROLE_NAME="heyari-tester-lambda"
API_NAME="heyari-report-api"            # shared with /api/report and /api/bug, on purpose
REPORT_FN="heyari-report"               # where the origin secret already lives
TESTER_FROM="${TESTER_FROM:-testers@heyari.dev}"
TESTER_TO="${TESTER_TO:-hey@heyari.dev}"
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"

ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
say() { printf '\n=== %s\n' "$1"; }

say "IAM role $ROLE_NAME"
if aws iam get-role --role-name "$ROLE_NAME" >/dev/null 2>&1; then
  echo "exists"
else
  aws iam create-role --role-name "$ROLE_NAME" \
    --description "Execution role for the heyari.dev testing-programme signup Lambda" \
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

# Same three resources the report function's policy names, and for the same
# non-obvious reasons: while SES is in the sandbox the RECIPIENT is itself a
# verified identity and SES authorises ses:SendEmail against it as well as the
# sender, and an identity can carry a default configuration set that SES
# applies — and authorises against — whether the caller asked for one or not.
# Wildcarded rather than pinned by name, because the name is a property of the
# SES setup rather than of this function.
#
# Both entries now resolve to the same verified domain, because the recipient
# moved onto heyari.dev. The recipient ARN is kept rather than dropped: it is
# what makes this correct again the day somebody points TESTER_TO at an
# address somewhere else.
FROM_DOMAIN="${TESTER_FROM#*@}"
aws iam put-role-policy --role-name "$ROLE_NAME" --policy-name ses-send \
  --policy-document "{
    \"Version\": \"2012-10-17\",
    \"Statement\": [{
      \"Effect\": \"Allow\",
      \"Action\": [\"ses:SendEmail\"],
      \"Resource\": [
        \"arn:aws:ses:$REGION:$ACCOUNT:identity/$FROM_DOMAIN\",
        \"arn:aws:ses:$REGION:$ACCOUNT:identity/$TESTER_TO\",
        \"arn:aws:ses:$REGION:$ACCOUNT:configuration-set/*\"
      ]
    }]
  }"
echo "put inline policy ses-send (from $FROM_DOMAIN, to $TESTER_TO)"

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

say "anti-spam secret"
# Signs the proof-of-work challenges the form solves. Generated here and reused
# on every re-run: rotating it invalidates every challenge already in a
# visitor's browser, which is survivable but rude to do by accident.
ALTCHA_SECRET="$(aws lambda get-function-configuration --function-name "$FUNCTION_NAME" \
  --region "$REGION" --query 'Environment.Variables.ALTCHA_SECRET' --output text 2>/dev/null || true)"
if [[ "$ALTCHA_SECRET" == "None" || -z "$ALTCHA_SECRET" ]]; then
  ALTCHA_SECRET="$(openssl rand -hex 32)"
  echo "generated a new anti-spam secret"
else
  echo "reusing the existing anti-spam secret"
fi

say "Lambda $FUNCTION_NAME"
ZIP="$("$ROOT/scripts/package-tester-fn.mjs")"
echo "packaged $ZIP"
if aws lambda get-function --function-name "$FUNCTION_NAME" --region "$REGION" >/dev/null 2>&1; then
  aws lambda update-function-code --function-name "$FUNCTION_NAME" --region "$REGION" \
    --zip-file "fileb://$ZIP" >/dev/null
  # A code update leaves the function InProgress, and the configuration update
  # below is refused while it is.
  aws lambda wait function-updated-v2 --function-name "$FUNCTION_NAME" --region "$REGION"
  echo "updated code"
else
  aws lambda create-function --function-name "$FUNCTION_NAME" --region "$REGION" \
    --runtime nodejs22.x --handler index.handler \
    --role "arn:aws:iam::$ACCOUNT:role/$ROLE_NAME" \
    --zip-file "fileb://$ZIP" \
    --timeout 10 --memory-size 256 \
    --description "Emails a heyari.dev testing-programme application to the maintainer" >/dev/null
  aws lambda wait function-active-v2 --function-name "$FUNCTION_NAME" --region "$REGION"
  echo "created"
fi

aws lambda update-function-configuration --function-name "$FUNCTION_NAME" --region "$REGION" \
  --environment "Variables={TESTER_FROM=$TESTER_FROM,TESTER_TO=$TESTER_TO,ORIGIN_SECRET=$ORIGIN_SECRET,ALTCHA_SECRET=$ALTCHA_SECRET}" >/dev/null
aws lambda wait function-updated-v2 --function-name "$FUNCTION_NAME" --region "$REGION"
echo "set TESTER_FROM=$TESTER_FROM TESTER_TO=$TESTER_TO"

# This form is public and unauthenticated. The honeypot and the proof-of-work
# challenge do the filtering; this is the backstop behind both. Two concurrent
# executions is what stops a burst becoming a bill, and SES's sandbox cap of
# 200 sends a day is the other half: past that the sends fail, which is a full
# inbox at worst, never a runaway invoice.
aws lambda put-function-concurrency --function-name "$FUNCTION_NAME" --region "$REGION" \
  --reserved-concurrent-executions 2 >/dev/null
echo "reserved concurrency 2"

say "route on $API_NAME"
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
# the report function while these two come here.
for ROUTE in "POST /api/tester" "POST /api/tester/challenge"; do
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
  POST https://heyari.dev/api/tester/challenge   (mints a proof-of-work challenge)
  POST https://heyari.dev/api/tester             (verifies it, then emails you)

=== Three things this script deliberately does not do

1. CloudFront is untouched. /api/* already points at $API_NAME, and the route
   above takes precedence over its \$default. Nothing to change, nothing to
   roll back.

2. It does not verify $TESTER_FROM with SES. If heyari.dev is already a
   verified domain identity — it is, the report function mails from it — then
   any address on it works and there is nothing to do.

3. The CodeBuild service role needs these on
     $FN_ARN
   so deploy.sh can ship new handler code:
     lambda:UpdateFunctionCode  lambda:GetFunction  lambda:GetFunctionConfiguration
   That role is shared with the site deploy, so widening it is a decision
   rather than a step:

  aws iam put-role-policy --role-name codebuild-ari-website-service-role \\
    --policy-name tester-fn-deploy --policy-document '{"Version":"2012-10-17",
      "Statement":[{"Effect":"Allow","Action":["lambda:UpdateFunctionCode",
        "lambda:GetFunction","lambda:GetFunctionConfiguration"],
      "Resource":"$FN_ARN"}]}'
NOTE

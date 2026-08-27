#!/usr/bin/env bash
# Turn CloudFront access logging for the distribution on or off.
#
#   ./infra/cloudfront-logging.sh on
#   ./infra/cloudfront-logging.sh off
#   ./infra/cloudfront-logging.sh tail        # last 10 minutes of /api/ requests
#
# Standard logging v2 into CloudWatch Logs, NOT the legacy S3 access logs: the
# legacy ones can take an hour to appear, which is no use when you are watching
# a request fail now. This lands in a couple of minutes.
#
# The delivery source must live in us-east-1 whatever region the distribution
# serves from — CloudFront is a global service and its logging control plane is
# in us-east-1 only. The log group goes there too so the two are together.
#
# This is a diagnostic, not part of the deploy. Turn it off when you are done:
# every request to heyari.dev is a log line, and log lines cost money.
set -euo pipefail

DIST_ID="${DIST_ID:-E3DZC8ECXAT4FZ}"
LOG_REGION="us-east-1"
LOG_GROUP="/aws/cloudfront/heyari-dev"
SOURCE_NAME="heyari-dev-access"
DEST_NAME="heyari-dev-access-cwl"
ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
DIST_ARN="arn:aws:cloudfront::$ACCOUNT:distribution/$DIST_ID"

case "${1:-}" in
  on)
    aws logs create-log-group --log-group-name "$LOG_GROUP" --region "$LOG_REGION" 2>/dev/null \
      && echo "created log group" || echo "log group exists"
    # Keep it short: this is a debugging aid that someone will forget to
    # switch off, and a week of heyari.dev traffic is plenty to look back on.
    aws logs put-retention-policy --log-group-name "$LOG_GROUP" --retention-in-days 7 \
      --region "$LOG_REGION"

    aws logs put-delivery-source --name "$SOURCE_NAME" --region "$LOG_REGION" \
      --resource-arn "$DIST_ARN" --log-type ACCESS_LOGS >/dev/null
    echo "delivery source $SOURCE_NAME -> $DIST_ID"

    DEST_ARN="$(aws logs put-delivery-destination --name "$DEST_NAME" --region "$LOG_REGION" \
      --delivery-destination-configuration \
        "destinationResourceArn=arn:aws:logs:$LOG_REGION:$ACCOUNT:log-group:$LOG_GROUP" \
      --query 'deliveryDestination.arn' --output text)"
    echo "delivery destination $DEST_ARN"

    aws logs create-delivery --delivery-source-name "$SOURCE_NAME" --region "$LOG_REGION" \
      --delivery-destination-arn "$DEST_ARN" \
      --record-fields date time c-ip sc-status cs-method cs-uri-stem x-host-header \
        x-edge-result-type x-edge-detailed-result-type x-edge-response-result-type \
      >/dev/null 2>&1 && echo "delivery created" || echo "delivery already exists"

    echo
    echo "Logging is on. Give it 2-3 minutes, make a request, then:"
    echo "  ./infra/cloudfront-logging.sh tail"
    ;;

  off)
    DELIVERY_ID="$(aws logs describe-deliveries --region "$LOG_REGION" \
      --query "deliveries[?deliverySourceName=='$SOURCE_NAME'].id | [0]" --output text)"
    if [[ "$DELIVERY_ID" != "None" && -n "$DELIVERY_ID" ]]; then
      aws logs delete-delivery --id "$DELIVERY_ID" --region "$LOG_REGION"
      echo "deleted delivery $DELIVERY_ID"
    fi
    aws logs delete-delivery-source --name "$SOURCE_NAME" --region "$LOG_REGION" 2>/dev/null \
      && echo "deleted delivery source" || true
    aws logs delete-delivery-destination --name "$DEST_NAME" --region "$LOG_REGION" 2>/dev/null \
      && echo "deleted delivery destination" || true
    echo "log group $LOG_GROUP left in place (7-day retention); delete it by hand if you want it gone"
    ;;

  tail)
    START=$(( ($(date +%s) - 600) * 1000 ))
    aws logs filter-log-events --log-group-name "$LOG_GROUP" --region "$LOG_REGION" \
      --start-time "$START" --query 'events[].message' --output text \
      | tr '\t' '\n' | grep -- '/api/' || echo "(no /api/ lines yet — logs lag a couple of minutes)"
    ;;

  *)
    echo "usage: $0 on|off|tail" >&2
    exit 2
    ;;
esac

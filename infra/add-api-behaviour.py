#!/usr/bin/env python3
"""Add the /api/* origin + cache behaviour to a CloudFront distribution config.

Reads the JSON that `aws cloudfront get-distribution-config` emits (the wrapper
with ETag and DistributionConfig), writes the bare DistributionConfig that
`aws cloudfront update-distribution` expects, and prints `changed` or
`unchanged` so the caller knows whether an update is worth making.

Everything else in the config is passed through untouched. This edits a live
distribution serving heyari.dev, so the rule is: add the two objects, change
nothing else, and leave the caller a backup to roll back to.

One constraint this file cannot fix, worth knowing before you debug against it:
CustomErrorResponses are set per DISTRIBUTION, not per behaviour, and this one
maps both 403 and 404 onto /404.html served from the S3 origin. So the API can
never usefully answer with either code — a 403 from the API reaches the
caller as the website's "This page wandered off" HTML, which hides the real
failure. The handler uses 400/405/413/502 for exactly that reason.

Usage: add-api-behaviour.py <get-distribution-config.json> <out.json>
Env:   ORIGIN_HOST, CACHE_POLICY, ORIGIN_REQUEST_POLICY, ORIGIN_SECRET
"""

import json
import os
import sys

ORIGIN_ID = "report-fn"
PATH_PATTERN = "/api/*"


def origin(host, secret):
    return {
        "Id": ORIGIN_ID,
        "DomainName": host,
        # No OAC: CloudFront does not support Origin Access Control for API
        # Gateway origins. This header is what replaces it — the execute-api
        # endpoint is reachable by anyone who learns its hostname, so the
        # function refuses any request that does not carry the secret, and
        # only CloudFront knows it.
        "OriginAccessControlId": "",
        "OriginPath": "",
        "CustomHeaders": {
            "Quantity": 1,
            "Items": [{"HeaderName": "x-origin-secret", "HeaderValue": secret}],
        },
        "CustomOriginConfig": {
            "HTTPPort": 80,
            "HTTPSPort": 443,
            "OriginProtocolPolicy": "https-only",
            "OriginSslProtocols": {"Quantity": 1, "Items": ["TLSv1.2"]},
            "OriginReadTimeout": 30,
            "OriginKeepaliveTimeout": 5,
        },
        "ConnectionAttempts": 3,
        "ConnectionTimeout": 10,
        "OriginShield": {"Enabled": False},
    }


def behaviour(cache_policy, origin_request_policy):
    return {
        "PathPattern": PATH_PATTERN,
        "TargetOriginId": ORIGIN_ID,
        "ViewerProtocolPolicy": "https-only",
        # POST is the whole point; the other verbs come with it because
        # CloudFront only offers this set as a group.
        "AllowedMethods": {
            "Quantity": 7,
            "Items": ["GET", "HEAD", "POST", "PUT", "PATCH", "OPTIONS", "DELETE"],
            "CachedMethods": {"Quantity": 2, "Items": ["GET", "HEAD"]},
        },
        # Off. There is nothing worth compressing in a JSON reply this small,
        # and compression makes CloudFront rewrite Accept-Encoding — which
        # AllViewerExceptHostHeader forwards to the origin. Harmless here, but
        # it was load-bearing while this origin was a SigV4-signed Function
        # URL, and turning it back on has no upside.
        "Compress": False,
        "CachePolicyId": cache_policy,
        "OriginRequestPolicyId": origin_request_policy,
        # Deliberately NO FunctionAssociations. The heyari-rewrite function
        # appends index.html to directory-style paths, which would turn
        # /api/report into /api/report/index.html and 403 off the bucket.
        # Behaviours are matched before their function runs, so simply leaving
        # it off this behaviour is enough — but it is the kind of thing that
        # gets "helpfully" added later, so: don't.
        "FunctionAssociations": {"Quantity": 0},
        "LambdaFunctionAssociations": {"Quantity": 0},
        "FieldLevelEncryptionId": "",
        "SmoothStreaming": False,
        "TrustedKeyGroups": {"Enabled": False, "Quantity": 0},
        "TrustedSigners": {"Enabled": False, "Quantity": 0},
    }


def main():
    src, dst = sys.argv[1], sys.argv[2]
    host = os.environ["ORIGIN_HOST"]
    cache_policy = os.environ["CACHE_POLICY"]
    origin_request_policy = os.environ["ORIGIN_REQUEST_POLICY"]
    secret = os.environ["ORIGIN_SECRET"]

    config = json.load(open(src))["DistributionConfig"]

    origins = config.setdefault("Origins", {"Quantity": 0, "Items": []})
    origins.setdefault("Items", [])
    behaviours = config.setdefault("CacheBehaviors", {"Quantity": 0, "Items": []})
    behaviours.setdefault("Items", [])

    changed = False

    wanted_origin = origin(host, secret)
    existing = next((o for o in origins["Items"] if o["Id"] == ORIGIN_ID), None)
    if existing is None:
        origins["Items"].append(wanted_origin)
        changed = True
    else:
        # Reconcile in place. This origin has already been a Lambda Function
        # URL with an OAC attached, so a re-run has to be able to repoint the
        # domain, clear the OAC and install the header — not just create.
        for key in ("DomainName", "OriginAccessControlId", "CustomHeaders"):
            if existing.get(key) != wanted_origin[key]:
                existing[key] = wanted_origin[key]
                changed = True
    origins["Quantity"] = len(origins["Items"])

    wanted = behaviour(cache_policy, origin_request_policy)
    current = next(
        (b for b in behaviours["Items"] if b.get("PathPattern") == PATH_PATTERN), None
    )
    if current is None:
        # First, so it wins over any broader pattern added later. CloudFront
        # matches in list order, not by specificity.
        behaviours["Items"].insert(0, wanted)
        changed = True
    else:
        # Reconcile in place rather than only creating. This behaviour has
        # already been shipped with settings that had to be corrected later, and
        # a script that can create but not correct is no use the day you need it.
        for key, value in wanted.items():
            if current.get(key) != value:
                current[key] = value
                changed = True
    behaviours["Quantity"] = len(behaviours["Items"])

    json.dump(config, open(dst, "w"))
    print("changed" if changed else "unchanged")


if __name__ == "__main__":
    main()

# ari-web

Static hosting for `heyari.dev` — currently the Ari ↔ Home Assistant OAuth flow,
and the home of the marketing site later.

## Contents
- `oauth/ha/index.html` — IndieAuth **client_id** page (carries the
  `<link rel="redirect_uri">` HA scans).
- `oauth/ha/callback/index.html` — OAuth **redirect_uri** landing page (200;
  intercepted by the verified Android App Link in practice).
- `.well-known/assetlinks.json` — Android **Digital Asset Links** for App Link
  verification (`dev.heyari.ari` + signing-cert SHA-256 fingerprints).
- `cf-rewrite.js` — CloudFront viewer-request Function: appends `index.html`
  to directory-style paths.
- `deploy.sh` — `aws s3 sync` + CloudFront invalidation. Set `BUCKET`/`DIST_ID` first.

## Deploy
```bash
BUCKET=<bucket> DIST_ID=<distribution-id> ./deploy.sh
```

## Infra
Private S3 (`eu-west-2`) → CloudFront (HTTPS, OAC) → apex `heyari.dev` via Route53;
ACM cert in `us-east-1`. Design + runbook:
`../docs/superpowers/specs/2026-06-15-heyari-dev-hosting-design.md` and the matching plan.

## Fingerprints (assetlinks.json)
`sha256_cert_fingerprints` is an array — currently the **debug** key (local
on-device testing). Append the **release** (self keystore or Google Play App
Signing) and **F-Droid** fingerprints before those channels ship; a missing
channel fingerprint silently breaks App Link verification for that channel.

# ari-web

Static hosting for **heyari.dev** — the marketing site and the preserved Ari
OAuth / Android App-Link surface today, with the skills browser and
documentation arriving in later phases.

## Layout
- `site/` — Astro marketing site. Its `public/` carries the preserved surface:
  - `public/oauth/client/index.html` — IndieAuth **client_id** page.
  - `public/oauth/callback/index.html` — OAuth **redirect_uri** landing page
    (intercepted by the verified Android App Link in practice).
  - `public/.well-known/assetlinks.json` — Android **Digital Asset Links**
    (`dev.heyari.ari` + signing-cert SHA-256 fingerprints).
- `docs/` — VitePress documentation (added in a later phase).
- `cf-rewrite.js` — CloudFront **Function**: appends `index.html` to directory
  paths and routes `/skills/<id>` to the detail template. Published by
  `deploy.sh`, so this file is the one serving traffic.
- `scripts/assemble.mjs` — merges build outputs into `dist/`.
- `deploy.sh` — builds, assembles, `aws s3 sync`, publishes `cf-rewrite.js`,
  CloudFront invalidation.

## Develop
```bash
npm install
npm run dev        # Astro dev server
npm test           # cf-rewrite unit tests + build-output assertions
```

## Deploy
```bash
BUCKET=heyari-dev-static DIST_ID=E3DZC8ECXAT4FZ ./deploy.sh
```

## Infra
Private S3 (`eu-west-2`) → CloudFront (HTTPS, OAC) → apex `heyari.dev` via
Route53; ACM cert in `us-east-1`. Fully serverless (no Lambda). Design +
runbook: `../docs/superpowers/specs/2026-07-24-heyari-dev-website-design.md`.

URL routing is the `heyari-rewrite` CloudFront Function, sourced from
`cf-rewrite.js` and published by `deploy.sh`. It was manually managed until
2026-08-06 and drifted six weeks behind the repo, which broke every
`/skills/<id>` deep-link with a 403 — a private bucket answers a missing key
with "access denied", not "not found", so the symptom named the wrong problem.
Deploying it from source is what stops that recurring. Note the bucket is
private: any path the function fails to rewrite onto a real key surfaces as a
403, so reach for this file first when a URL that should exist says access
denied.

## Fingerprints (assetlinks.json)
`sha256_cert_fingerprints` holds one entry: the **shared debug key** committed
at `ari-android/app/debug.keystore`. Every machine and CI runner signs debug
builds with it, so there is exactly one debug fingerprint to publish rather
than one per developer. Append the **release** (self keystore or Play App
Signing) and **F-Droid** fingerprints before those channels ship — a missing
channel fingerprint silently breaks App Link verification for that channel.

Silently is the word. Android reports `heyari.dev: legacy_failure` and simply
declines to hand the callback to the app — the browser keeps the redirect and
shows a bare landing page with nothing to explain itself. Home Assistant
sign-in dead-ends there. Check with:

```bash
adb shell pm get-app-links dev.heyari.ari      # want: heyari.dev: approved
```

If it fails, confirm the APK is actually signed with the shared key rather than
a leftover per-machine one:

```bash
apksigner verify --print-certs app/build/outputs/apk/debug/app-debug.apk
# want SHA-256 digest 9eb9bef9…, DN "CN=Ari Debug"
```

Verification also needs this site deployed — the fingerprint only counts once
heyari.dev is actually serving it. To unblock a machine before that, approve
the domain locally; note it is per-install and lost on every uninstall:

```bash
adb shell pm set-app-links --package dev.heyari.ari 2 heyari.dev
```

**Before public release**, drop the debug fingerprint from this file. It is
public by design, so anyone can build a debug APK that App Links will trust for
heyari.dev. The OAuth flow uses PKCE (S256), so an intercepted authorization
code is not redeemable without the verifier that never leaves the real app —
but that is a mitigation, not a reason to ship it.

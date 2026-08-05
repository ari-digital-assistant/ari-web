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
  paths and routes `/skills/<id>` to the detail template.
- `scripts/assemble.mjs` — merges build outputs into `dist/`.
- `deploy.sh` — builds, assembles, `aws s3 sync`, CloudFront invalidation.

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

## Fingerprints (assetlinks.json)
`sha256_cert_fingerprints` is an array — currently two **debug** keys, from two
dev machines. Append the **release** (self keystore or Play App Signing) and
**F-Droid** fingerprints before those channels ship; a missing channel
fingerprint silently breaks App Link verification for that channel.

Silently is the word. Android reports `heyari.dev: legacy_failure` and simply
declines to hand the callback to the app — the browser keeps the redirect and
shows a bare landing page with nothing to explain itself. Home Assistant
sign-in dead-ends there. Check with:

```bash
adb shell pm get-app-links dev.heyari.ari      # want: heyari.dev: approved
```

An unlisted key is the usual cause, and every new dev machine generates one
(`~/.config/.android/debug.keystore` on Linux, or `~/.android/`). Read yours
with:

```bash
keytool -list -v -keystore ~/.config/.android/debug.keystore \
        -storepass android -alias androiddebugkey | grep SHA256
```

To unblock a machine without waiting on a deploy, approve the domain locally —
note this is per-install and is lost on every uninstall:

```bash
adb shell pm set-app-links --package dev.heyari.ari 2 heyari.dev
```

The durable fix is a committed debug keystore plus a `signingConfig` pointing
at it in `ari-android`, so the debug fingerprint stops changing per machine and
only needs listing once. Normal practice for a debug key; not yet done.

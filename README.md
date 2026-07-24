# ari-web

Static hosting for **heyari.dev** — the marketing site, the skills browser, the
docs, and the preserved Ari OAuth / Android App-Link surface.

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
npm test           # cf-rewrite + build assertions
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
`sha256_cert_fingerprints` is an array — currently the **debug** key. Append the
**release** (self keystore or Play App Signing) and **F-Droid** fingerprints
before those channels ship; a missing channel fingerprint silently breaks App
Link verification for that channel.

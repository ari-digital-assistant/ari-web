# ari-web

Static hosting for **heyari.dev** — the marketing site, the skills browser, the
documentation, and the Ari OAuth / Android App-Link surface. Four small Lambdas
sit behind `/api/*` for bug reports, tester signup and contributed recordings;
everything else is files on S3.

## Layout
- `site/` — Astro marketing site and skills browser (`/`, `/skills`,
  `/skills/<id>`, `/privacy`, `/tester`, `/delete-data`, `/404`). Its `public/`
  carries the App-Link surface:
  - `public/oauth/client/index.html` — IndieAuth **client_id** page.
  - `public/oauth/callback/index.html` — OAuth **redirect_uri** landing page
    (intercepted by the verified Android App Link in practice).
  - `public/.well-known/assetlinks.json` — Android **Digital Asset Links**
    (`dev.heyari.ari` + signing-cert SHA-256 fingerprints).
- `docs/` — VitePress documentation, served at `/docs`.
- `functions/` — the `/api/*` Lambdas: `report` (maintainer reports),
  `bugreport` (the in-app bug reporter), `tester` (Play internal-testing
  signup), `contrib` (recordings a user chose to contribute). `deploy.sh`
  updates their code; it never creates them.
- `infra/` — one-off provisioning and rollback scripts, plus dated distribution
  backups. Run by hand, never by CI.
- `cf-rewrite.js` — CloudFront **Function**: appends `index.html` to directory
  paths, routes `/skills/<id>` to the detail template, and resolves the docs
  section indexes. Published by `deploy.sh`, so this file is the one serving
  traffic.
- `scripts/assemble.mjs` — merges site + docs builds into `dist/` and injects
  the prerendered skill ids and docs directories into `build/cf-rewrite.js`.
- `deploy.sh` — builds, assembles, `aws s3 sync`, publishes `cf-rewrite.js`,
  updates the Lambdas, invalidates CloudFront.
- `buildspec.yml` — the CodeBuild pipeline that runs all of the above.

## Develop
```bash
npm install
npm run dev                        # Astro dev server
npm run dev --workspace docs       # VitePress dev server
npm run build                      # site + docs
npm test                           # routing, Lambdas, and page assertions
```

The page suites run `astro build` themselves, so `npm test` needs no prior
build — but it does need a complete `node_modules`. If vitest dies looking for
`tinypool`, run `npm ci`.

## Deploy

A push to `main` triggers CodeBuild, which gates on `npm run audit` and
`npm test` **before** `deploy.sh` touches S3. AWS access comes from the
CodeBuild project's IAM service role — no stored keys, no OIDC role. The
required permissions are listed at the top of `buildspec.yml`.

To deploy by hand:

```bash
BUCKET=heyari-dev-static DIST_ID=E3DZC8ECXAT4FZ ./deploy.sh
```

## Infra
Private S3 (`eu-west-2`) → CloudFront (HTTPS, OAC) → apex `heyari.dev` via
Route53; ACM cert in `us-east-1`. Everything under `/docs`, `/skills` and the
marketing pages is prerendered and static. The only compute is the four
`/api/*` Lambdas in `eu-west-2`, created by the `infra/provision-*-api.sh`
scripts — CI only ever updates code on infrastructure that already exists.

Contributed recordings live in their own bucket (`heyari-contributions`), not
alongside the bug reports. That bucket expires everything at 90 days, which is
the promise its consent text makes; a training corpus that evaporates is no use
to anyone. One bucket could not honour both, and a lifecycle rule is far too
quiet a thing to get wrong. The contributions bucket also has versioning
suspended on purpose, so "delete my shared data" really does delete.
Design + runbook: `../docs/superpowers/specs/2026-07-24-heyari-dev-website-design.md`.

URL routing is the `heyari-rewrite` CloudFront Function, sourced from
`cf-rewrite.js` and published by `deploy.sh`. It was manually managed until
2026-08-06 and drifted six weeks behind the repo, which broke every
`/skills/<id>` deep-link with a 403 — a private bucket answers a missing key
with "access denied", not "not found", so the symptom named the wrong problem.
Deploying it from source is what stops that recurring. Note the bucket is
private: any path the function fails to rewrite onto a real key surfaces as a
403, so reach for this file first when a URL that should exist says access
denied.

**Custom error responses** map both 403 and 404 to `/404.html` with a 404
status, which is what makes the branded 404 page reachable — until 2026-08-21
the distribution had none configured, so every mistyped URL returned S3's
`AccessDenied` XML and the page that had been building since Phase 1 was never
served to anyone. This is distribution config, not something `deploy.sh`
publishes, so it is set once:

```bash
aws cloudfront get-distribution-config --id E3DZC8ECXAT4FZ \
  --query 'DistributionConfig.CustomErrorResponses'
```

Two consequences worth knowing. A genuine origin permission failure now renders
the 404 page rather than surfacing as a 403, because a private bucket gives
CloudFront no way to tell "missing" from "forbidden" — check the bucket policy
and OAC if pages that should exist start 404ing en masse. And `/docs/*` errors
get this page too, not VitePress's own 404, since error responses are
distribution-wide and cannot vary per path.

## Fingerprints (assetlinks.json)

`sha256_cert_fingerprints` carries one entry per signing certificate Ari ships
through:

| Fingerprint starts | Channel |
|---|---|
| `6C:D9:DF:…` | **Play app signing** — every install from the store. Google holds this key. |
| `17:39:84:…` | **Upload key** — the beta and release APKs built here and sideloaded. |

Play App Signing strips the upload signature and re-signs with Google's own key,
so a store install presents a certificate the upload key knows nothing about.
Both entries are pinned by `site/test/preserved.test.js`, because losing one
costs an afternoon to diagnose and nothing to prevent.

The **shared debug key was removed on 2026-09-14**. It was public by design —
anyone could build a debug APK that App Links would trust for heyari.dev — and
debug builds no longer need to finish an OAuth flow through a verified link.

Silence is how all of this fails. Android reports `heyari.dev: legacy_failure`
and simply declines to hand the callback to the app — the browser keeps the
redirect and shows a bare landing page with nothing to explain itself. Home
Assistant sign-in dead-ends there. Check with:

```bash
adb shell pm get-app-links dev.heyari.ari      # want: heyari.dev: approved
```

Verification also needs this site deployed — a fingerprint only counts once
heyari.dev is actually serving it.

**On a debug build it will never say `approved`**, by design, since that
fingerprint is gone. Approve the domain locally instead; it is per-install and
lost on every uninstall:

```bash
adb shell pm set-app-links --package dev.heyari.ari 2 heyari.dev
```

If a *beta or release* build fails verification, confirm the APK is signed with
the upload key rather than a leftover per-machine one:

```bash
apksigner verify --print-certs app/build/outputs/apk/beta/app-beta.apk
```

Add the **F-Droid** fingerprint here before that channel ships. A missing
channel fingerprint breaks App Link verification for that channel, silently.

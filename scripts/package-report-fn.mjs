#!/usr/bin/env node
// Build the deployment zip for the /api/report Lambda and print its path.
//
// The function is an npm workspace, so its dependencies are hoisted to the
// repo root and `functions/report/node_modules` is nearly empty — zipping the
// directory as-is produces a Lambda that dies on `Cannot find package
// '@aws-sdk/client-sesv2'`. So: stage the two source files somewhere clean,
// install into that directory with workspaces off, and zip the result.
//
// Only the zip path goes to stdout; everything else goes to stderr so the
// caller can capture the path with a plain command substitution.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const src = join(root, 'functions', 'report');

const stage = mkdtempSync(join(tmpdir(), 'ari-report-fn-'));
const zip = join(stage, 'report-fn.zip');
const pkg = join(stage, 'pkg');

execFileSync('mkdir', ['-p', pkg]);
for (const f of ['index.mjs', 'package.json']) {
  copyFileSync(join(src, f), join(pkg, f));
}

// --no-workspaces stops npm walking up to the root manifest and hoisting.
// --omit=dev because there are no dev deps to ship, and the CodeBuild audit
// gate already covers the production tree.
execFileSync(
  'npm',
  ['install', '--no-workspaces', '--omit=dev', '--no-audit', '--no-fund', '--silent'],
  { cwd: pkg, stdio: ['ignore', 'inherit', 'inherit'] },
);

// A lockfile in the zip is dead weight and confuses nothing but a reader.
rmSync(join(pkg, 'package-lock.json'), { force: true });

execFileSync('zip', ['-qr', zip, '.'], { cwd: pkg, stdio: ['ignore', 'inherit', 'inherit'] });

process.stdout.write(zip);

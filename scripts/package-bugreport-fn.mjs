#!/usr/bin/env node
// Build the deployment zip for the /api/bug Lambda and print its path.
//
// Same shape as package-report-fn.mjs and for the same reason: the function is
// an npm workspace, so its dependencies are hoisted to the repo root and
// zipping the directory as-is produces a Lambda that dies looking for
// @aws-sdk. The only difference is that this function is three source files
// rather than one.
//
// Only the zip path goes to stdout; everything else goes to stderr so the
// caller can capture the path with a plain command substitution.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, copyFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const src = join(root, 'functions', 'bugreport');

const stage = mkdtempSync(join(tmpdir(), 'ari-bugreport-fn-'));
const zip = join(stage, 'bugreport-fn.zip');
const pkg = join(stage, 'pkg');

execFileSync('mkdir', ['-p', pkg]);

// Every source file, discovered rather than listed. A hardcoded list silently
// omitted auth.mjs the day it was added, and the result was not a build error
// but a Lambda that loaded fine locally and 500'd on every request in
// production — including the ones that had nothing to do with the new file.
const sources = readdirSync(src).filter((f) => f.endsWith('.mjs'));
if (sources.length === 0) throw new Error(`no .mjs sources in ${src}`);
for (const f of [...sources, 'package.json']) {
  copyFileSync(join(src, f), join(pkg, f));
}
console.error(`staging ${sources.length} source files: ${sources.join(', ')}`);

execFileSync(
  'npm',
  ['install', '--no-workspaces', '--omit=dev', '--no-audit', '--no-fund', '--silent'],
  { cwd: pkg, stdio: ['ignore', 'inherit', 'inherit'] },
);

rmSync(join(pkg, 'package-lock.json'), { force: true });

execFileSync('zip', ['-qr', zip, '.'], { cwd: pkg, stdio: ['ignore', 'inherit', 'inherit'] });

process.stdout.write(zip);

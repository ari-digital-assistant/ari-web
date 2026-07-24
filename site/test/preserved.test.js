import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, it, expect, beforeAll } from 'vitest';
import { execSync } from 'node:child_process';

const root = new URL('../../', import.meta.url);
const sha = (p) => createHash('sha256').update(readFileSync(new URL(p, import.meta.url))).digest('hex');

beforeAll(() => execSync('npm run build --workspace site', { cwd: root }), 120000);

describe('preserved OAuth + App-Link surface', () => {
  it('assetlinks.json survives the build byte-for-byte', () => {
    expect(sha('../dist/.well-known/assetlinks.json'))
      .toBe(sha('../public/.well-known/assetlinks.json'));
  });
  it('oauth pages survive the build byte-for-byte', () => {
    expect(sha('../dist/oauth/client/index.html')).toBe(sha('../public/oauth/client/index.html'));
    expect(sha('../dist/oauth/callback/index.html')).toBe(sha('../public/oauth/callback/index.html'));
  });
  it('assetlinks still declares the Ari package', () => {
    const j = JSON.parse(readFileSync(new URL('../dist/.well-known/assetlinks.json', import.meta.url), 'utf8'));
    expect(j[0].target.package_name).toBe('dev.heyari.ari');
  });
  it('favicon.svg is present in the built output', () => {
    expect(existsSync(new URL('../dist/favicon.svg', import.meta.url))).toBe(true);
  });
});

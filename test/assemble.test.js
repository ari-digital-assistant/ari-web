import { existsSync } from 'node:fs';
import { describe, it, expect, beforeAll } from 'vitest';
import { execSync } from 'node:child_process';

const root = new URL('../', import.meta.url);
beforeAll(() => {
  execSync('npm run build --workspace site', { cwd: root });
  execSync('node scripts/assemble.mjs', { cwd: root });
}, 180000);

describe('assemble', () => {
  it('produces a root dist/ with the home page', () => {
    expect(existsSync(new URL('./dist/index.html', root))).toBe(true);
  });
  it('carries the preserved surface into dist/', () => {
    expect(existsSync(new URL('./dist/.well-known/assetlinks.json', root))).toBe(true);
    expect(existsSync(new URL('./dist/oauth/callback/index.html', root))).toBe(true);
  });
});

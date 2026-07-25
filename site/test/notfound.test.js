import { readFileSync, existsSync } from 'node:fs';
import { describe, it, expect, beforeAll } from 'vitest';
import { execSync } from 'node:child_process';

let html;
beforeAll(() => {
  execSync('npm run build --workspace site', { cwd: new URL('../../', import.meta.url) });
  const p = new URL('../dist/404.html', import.meta.url);
  html = existsSync(p) ? readFileSync(p, 'utf8') : '';
}, 120000);

describe('404 page', () => {
  it('builds a 404.html', () => {
    expect(html.length).toBeGreaterThan(0);
  });
  it('is branded (wordmark) and links home', () => {
    expect(html).toContain('>Ari<');
    expect(html).toContain('href="/"');
  });
  it('has friendly not-found copy', () => {
    expect(html).toMatch(/wandered off|not here|doesn't exist|nothing here/i);
  });
});

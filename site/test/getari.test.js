import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeAll } from 'vitest';
import { execSync } from 'node:child_process';

let html;
beforeAll(() => {
  execSync('npm run build --workspace site', { cwd: new URL('../../', import.meta.url) });
  html = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');
}, 120000);

describe('get ari section', () => {
  it('has the section anchor and honest pre-release heading', () => {
    expect(html).toContain('id="get"');
    expect(html).toContain('Not out yet');
  });
  it('has a real Star-on-GitHub CTA and NO fake store links', () => {
    expect(html).toContain('https://github.com/ari-digital-assistant');
    expect(html).not.toMatch(/play\.google\.com|f-droid\.org\/[a-z]|apps\.apple\.com/i);
    expect(html).toMatch(/coming soon/i);
  });
});

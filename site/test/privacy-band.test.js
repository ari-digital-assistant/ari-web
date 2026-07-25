import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeAll } from 'vitest';
import { execSync } from 'node:child_process';

let html;
beforeAll(() => {
  execSync('npm run build --workspace site', { cwd: new URL('../../', import.meta.url) });
  html = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');
}, 120000);

describe('privacy teaser band', () => {
  it('has the section anchor and heading', () => {
    expect(html).toContain('id="privacy"');
    expect(html).toContain('Your data stays yours');
  });
  it('states the honest on-device AND opt-in-cloud story (not absolutism)', () => {
    expect(html).toMatch(/on your device|on the phone/i);
    expect(html).toMatch(/opt-in|your call|you decide|only when you say/i);
  });
  it('links to the full privacy page', () => {
    expect(html).toContain('href="/privacy"');
  });
});

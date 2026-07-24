import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeAll } from 'vitest';
import { execSync } from 'node:child_process';

let html;
beforeAll(() => {
  execSync('npm run build --workspace site', { cwd: new URL('../../', import.meta.url) });
  html = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');
}, 120000);

describe('home hero', () => {
  it('states the privacy thesis headline', () => {
    expect(html).toContain('never');
    expect(html).toContain('phones home');
  });
  it('has an honest pre-release primary CTA (no fake store links)', () => {
    expect(html).toContain('Star on GitHub');
    expect(html).not.toMatch(/play\.google\.com|f-droid\.org\/[a-z]/i);
  });
  it('shows the three trust markers', () => {
    for (const t of ['Runs offline', 'No telemetry', 'open-source']) expect(html).toContain(t);
  });
});

import { readFileSync, existsSync } from 'node:fs';
import { describe, it, expect, beforeAll } from 'vitest';
import { execSync } from 'node:child_process';

let html;
beforeAll(() => {
  execSync('npm run build --workspace site', { cwd: new URL('../../', import.meta.url) });
  html = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');
}, 120000);

describe('friendly manifesto', () => {
  it('the temporary friendly/ folder is gone', () => {
    expect(existsSync(new URL('../../friendly', import.meta.url))).toBe(false);
  });
  it('the footer badge links to the manifesto', () => {
    expect(html).toContain('href="https://friendlymanifesto.org"');
  });
  it('renders a theme-aware badge (both variants present)', () => {
    expect(html).toMatch(/badge-black|badge-colour/);
    expect(html).toContain('badge-white');
  });
});

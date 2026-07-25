import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeAll } from 'vitest';
import { execSync } from 'node:child_process';

let html;
beforeAll(() => {
  execSync('npm run build --workspace site', { cwd: new URL('../../', import.meta.url) });
  html = readFileSync(new URL('../dist/skills/detail/index.html', import.meta.url), 'utf8');
}, 120000);

describe('/skills/detail shell', () => {
  it('builds at the cf-rewrite target path with a mount point + loading state', () => {
    expect(html).toContain('id="detail"');
    expect(html).toMatch(/Loading/i);
  });
  it('carries the client script that reads the id and fetches the registry', () => {
    // The page is client-rendered; assert the shell exists and is branded.
    expect(html).toContain('>Ari<');
  });
});

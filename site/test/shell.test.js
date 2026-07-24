import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeAll } from 'vitest';
import { execSync } from 'node:child_process';

let html;
beforeAll(() => {
  execSync('npm run build --workspace site', { cwd: new URL('../../', import.meta.url) });
  html = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');
}, 120000);

describe('site shell', () => {
  it('has one nav and one contentinfo landmark', () => {
    expect((html.match(/<header/g) || []).length).toBeGreaterThanOrEqual(1);
    expect(html).toContain('<footer');
  });
  it('shows the brand wordmark and primary nav links', () => {
    expect(html).toContain('>Ari<');
    for (const label of ['Features', 'Privacy', 'Skills', 'Docs']) {
      expect(html).toContain(`>${label}<`);
    }
  });
  it('footer links to the four open-source repos section', () => {
    expect(html).toContain('Open source');
    expect(html).toContain('href="https://github.com/ari-digital-assistant');
  });
});

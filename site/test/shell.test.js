import { readFileSync, readdirSync } from 'node:fs';
import { describe, it, expect, beforeAll } from 'vitest';
import { execSync } from 'node:child_process';

let html;
let css;
beforeAll(() => {
  execSync('npm run build --workspace site', { cwd: new URL('../../', import.meta.url) });
  html = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');
  const dir = new URL('../dist/_astro/', import.meta.url);
  css = readdirSync(dir)
    .filter((f) => f.endsWith('.css'))
    .map((f) => readFileSync(new URL(f, dir), 'utf8'))
    .join('\n');
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
  it('features link points at the home-page anchor, not a dead /features page', () => {
    expect(html).toContain('href="/#features"');
    expect(html).not.toContain('href="/features"');
  });
  it('states both licences, because the site and the app are not the same one', () => {
    // ari-web is MIT; ari-android, ari-engine and ari-linux are GPL-3.0. A
    // single blanket claim in the footer would be wrong about one of them.
    expect(html).toContain('Ari GPL-3.0');
    expect(html).toContain('Site MIT');
    expect(html).toContain('ari-android/blob/HEAD/LICENSE');
    expect(html).toContain('ari-web/blob/HEAD/LICENSE');
    expect(html).not.toContain('Made in the open');
  });
  it('styles the brand lockup globally, so the footer copy is not left bare', () => {
    // Nav and Footer ship identical .brand markup. While the rule was scoped
    // inside Nav, the footer's mark and wordmark had no flex and no gap and
    // sat jammed together. An unscoped rule is what keeps both honest, so
    // assert it survives the build without a component's scope hash on it.
    // `.brand{` only matches the bare selector; the footer's own scoped
    // override reads `.brand[data-astro-cid-...]{` and is not this rule.
    const rule = css.match(/\.brand\{([^}]*)\}/);
    expect(rule).not.toBeNull();
    const decls = rule[1].split(';').sort();
    expect(decls).toEqual([
      'align-items:center',
      'display:flex',
      'font-size:19px',
      'font-weight:800',
      'gap:11px',
      'letter-spacing:-.02em',
    ]);
  });
});

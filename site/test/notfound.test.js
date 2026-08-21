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
  it('references nothing relative, so it renders wherever CloudFront serves it', () => {
    // This is the page the distribution returns for a 403/404, at whatever URL
    // the visitor asked for — /a/b/c included. A relative href would resolve
    // against that path and 404 in turn, leaving an unstyled error page.
    const urls = [...html.matchAll(/(?:href|src)="([^"]*)"/g)].map((m) => m[1]);
    expect(urls.length).toBeGreaterThan(0);
    const relative = urls.filter((u) => !/^([a-z]+:|\/\/|\/|#)/i.test(u));
    expect(relative).toEqual([]);
  });
});

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { describe, it, expect, beforeAll } from 'vitest';
import { execSync } from 'node:child_process';

const root = new URL('../', import.meta.url);
beforeAll(() => {
  execSync('npm run build', { cwd: root });
  execSync('node scripts/assemble.mjs', { cwd: root });
}, 300000);

describe('assemble', () => {
  it('produces a root dist/ with the home page', () => {
    expect(existsSync(new URL('./dist/index.html', root))).toBe(true);
  });
  it('carries the preserved surface into dist/', () => {
    expect(existsSync(new URL('./dist/.well-known/assetlinks.json', root))).toBe(true);
    expect(existsSync(new URL('./dist/oauth/callback/index.html', root))).toBe(true);
  });
  it('assembles the VitePress docs under dist/docs', () => {
    expect(existsSync(new URL('./dist/docs/index.html', root))).toBe(true);
  });
});

describe('routing function built from the assembled tree', () => {
  const load = (path) => {
    const src = readFileSync(new URL(path, root), 'utf8');
    const handler = new Function(src + '\nreturn handler;')();
    return (uri) => handler({ request: { uri } }).uri;
  };
  const built = () => load('./build/cf-rewrite.js');
  const dist = new URL('./dist/', root);
  const prerenderedIds = () => readdirSync(new URL('./dist/skills/', root), { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== 'detail')
    .map((e) => e.name);

  it('prerenders a page for every skill in the registry', () => {
    const ids = prerenderedIds();
    expect(ids.length).toBeGreaterThan(0);
    const mirrored = JSON.parse(readFileSync(new URL('./dist/skills.json', root), 'utf8')).skills.map((s) => s.id);
    expect([...ids].sort()).toEqual([...mirrored].sort());
  });

  it('routes every prerendered id to its own page, not the shared template', () => {
    const run = built();
    for (const id of prerenderedIds()) {
      const uri = run(`/skills/${id}`);
      expect(uri, id).toBe(`/skills/${id}/index.html`);
      expect(existsSync(new URL(`.${uri}`, dist)), uri).toBe(true);
      expect(run(`/skills/${id}/`), `${id} with trailing slash`).toBe(uri);
    }
  });

  it('still falls back to the template for a skill published since the build', () => {
    const run = built();
    expect(run('/skills/dev.heyari.notyetbuilt')).toBe('/skills/detail/index.html');
    expect(existsSync(new URL('./dist/skills/detail/index.html', root))).toBe(true);
  });

  it('degrades to the old behaviour if the id list is never injected', () => {
    // The committed source ships an empty list on purpose: a missing assemble
    // step should send every id to the client-rendered template, not 403.
    const run = load('./cf-rewrite.js');
    expect(run('/skills/dev.heyari.timer')).toBe('/skills/detail/index.html');
  });

  it('redirects the bare form of every docs section index instead of 404ing', () => {
    // cleanUrls makes VitePress write flat <name>.html files, so appending
    // .html to /docs/develop asks for a key that isn't there — and that URL
    // resolved fine before cleanUrls, so getting it wrong is a regression, not
    // just a gap.
    const handler = new Function(readFileSync(new URL('./build/cf-rewrite.js', root), 'utf8') + '\nreturn handler;')();
    const dirs = readdirSync(new URL('./dist/docs/', root), { withFileTypes: true })
      .filter((e) => e.isDirectory() && existsSync(new URL(`./dist/docs/${e.name}/index.html`, root)))
      .map((e) => `/docs/${e.name}`);
    expect(dirs.length).toBeGreaterThan(0);
    for (const dir of dirs) {
      const res = handler({ request: { uri: dir } });
      expect(res.statusCode, dir).toBe(301);
      expect(res.headers.location.value, dir).toBe(`${dir}/`);
      // ...and the target it points at is a file that exists.
      const followed = handler({ request: { uri: `${dir}/` } }).uri;
      expect(existsSync(new URL(`.${followed}`, dist)), followed).toBe(true);
    }
  });

  it('stays well inside the 10 KB CloudFront Function limit', () => {
    const bytes = readFileSync(new URL('./build/cf-rewrite.js', root)).length;
    expect(bytes).toBeLessThan(8192);
  });

  it('every skill URL in the sitemap resolves to a file that exists', () => {
    const run = built();
    const xml = readFileSync(new URL('./dist/sitemap-0.xml', root), 'utf8');
    const urls = [...xml.matchAll(/<loc>https:\/\/heyari\.dev(\/skills\/[^<]*)<\/loc>/g)].map((m) => m[1]);
    expect(urls.length).toBeGreaterThan(1);
    const broken = urls.filter((u) => !existsSync(new URL(`.${run(u)}`, dist)));
    expect(broken).toEqual([]);
  });
});

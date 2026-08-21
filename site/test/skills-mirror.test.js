import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { describe, it, expect, beforeAll } from 'vitest';
import { execSync } from 'node:child_process';
import { screenshotPaths } from '../src/lib/skills.js';

const dist = new URL('../dist/', import.meta.url);
let mirror, bundles;
beforeAll(() => {
  execSync('npm run build --workspace site', { cwd: new URL('../../', import.meta.url) });
  mirror = JSON.parse(readFileSync(new URL('./skills.json', dist), 'utf8'));
  bundles = readdirSync(new URL('./_astro/', dist))
    .filter((f) => f.endsWith('.js'))
    .map((f) => readFileSync(new URL(`./_astro/${f}`, dist), 'utf8'));
}, 120000);

describe('same-origin registry mirror', () => {
  it('bakes the registry index into the site as /skills.json', () => {
    expect(mirror.index_version).toBe(1);
    expect(Array.isArray(mirror.skills)).toBe(true);
    expect(mirror.skills.length).toBeGreaterThan(0);
  });
  it('mirrors every field the skills UI reads, for every skill', () => {
    // lib/skills.js reads all of these; a registry that dropped one would
    // render "undefined" into a card rather than fail, so check them here.
    for (const s of mirror.skills) {
      for (const key of ['id', 'name', 'description', 'type', 'version', 'author']) {
        expect(typeof s[key], `${s.id || '?'}.${key}`).toBe('string');
      }
      expect(Array.isArray(s.capabilities), `${s.id}.capabilities`).toBe(true);
      expect(['skill', 'assistant']).toContain(s.type);
      // license is nullable in the registry (dev.heyari.message ships null);
      // detailHtml()'s esc() turns that into an empty row rather than crashing.
      expect(['string', 'object'], `${s.id}.license`).toContain(typeof s.license);
    }
  });
  it('the skills grid reads the mirror rather than GitHub', () => {
    expect(bundles.filter((b) => /['"`]\/skills\.json['"`]/.test(b)).length).toBe(1);
  });
  it('leaves the fallback template on the live registry, which is the point of it', () => {
    // /skills/detail is only served for an id with no prerendered page — i.e. a
    // skill published since the build the mirror was taken from. Pointing it at
    // the mirror would guarantee "skill not found" for exactly the case it exists
    // to handle.
    const fallback = bundles.filter((b) => b.includes('index.json'));
    expect(fallback.length).toBe(1);
    // ...and it is not the bundle that reads the mirror.
    expect(fallback[0]).not.toMatch(/['"`]\/skills\.json['"`]/);
  });
});

describe('mirrored screenshots', () => {
  const asset = (path) => new URL(`./registry/${path}`, dist);

  it('copies in every screenshot the mirrored index references', () => {
    const paths = screenshotPaths(mirror.skills);
    expect(paths.length).toBeGreaterThan(0);
    expect(paths.filter((p) => !existsSync(asset(p)))).toEqual([]);
  });

  it('copies real image bytes, not empty or error-page files', () => {
    for (const path of screenshotPaths(mirror.skills)) {
      const bytes = readFileSync(asset(path));
      expect(statSync(asset(path)).size, path).toBeGreaterThan(1024);
      // WebP is a RIFF container: "RIFF" then 4 size bytes then "WEBP".
      expect(bytes.subarray(0, 4).toString('latin1'), path).toBe('RIFF');
      expect(bytes.subarray(8, 12).toString('latin1'), path).toBe('WEBP');
    }
  });

  it('mirrors nothing the index does not reference', () => {
    const walk = (dir) => readdirSync(dir, { withFileTypes: true })
      .flatMap((e) => (e.isDirectory() ? walk(new URL(`./${e.name}/`, dir)) : [new URL(`./${e.name}`, dir).pathname]));
    const onDisk = walk(new URL('./registry/', dist));
    expect(onDisk.length).toBe(screenshotPaths(mirror.skills).length);
  });

  it('serves them same-origin from the prerendered pages', () => {
    const withShots = mirror.skills.find((s) => Object.keys(s.screenshots || {}).length);
    const page = readFileSync(new URL(`./skills/${withShots.id}/index.html`, dist), 'utf8');
    const srcs = [...page.matchAll(/class="shot" src="([^"]*)"/g)].map((m) => m[1]);
    expect(srcs.length).toBeGreaterThan(0);
    for (const src of srcs) {
      expect(src.startsWith('/registry/'), src).toBe(true);
      expect(existsSync(new URL(`.${src}`, dist)), src).toBe(true);
    }
  });

  it('unfurls off the mirror too, with an absolute URL as og:image requires', () => {
    const withShots = mirror.skills.find((s) => Object.keys(s.screenshots || {}).length);
    const page = readFileSync(new URL(`./skills/${withShots.id}/index.html`, dist), 'utf8');
    const image = page.match(/<meta property="og:image" content="([^"]*)"/)[1];
    expect(image.startsWith('https://heyari.dev/registry/screenshots/'), image).toBe(true);
    expect(existsSync(new URL(`.${image.replace('https://heyari.dev', '')}`, dist))).toBe(true);
  });
});

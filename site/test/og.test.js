import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { describe, it, expect, beforeAll } from 'vitest';
import { execSync } from 'node:child_process';
import sharp from 'sharp';

// Link previews. Every page gets them from Base.astro, so rather than check a
// few pages by name, walk everything the build wrote: a page added later is
// covered without anyone remembering to add it here.
const dist = new URL('../dist/', import.meta.url);
const read = (p) => readFileSync(new URL(p, dist), 'utf8');
const unescape = (v) => v.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const meta = (html, attr, name) => {
  const m = html.match(new RegExp(`<meta ${attr}="${name}" content="([^"]*)"`));
  return m ? unescape(m[1]) : null;
};
const local = (url) => new URL(`.${new URL(url).pathname}`, dist);

// Pages served from somewhere other than their own path. /oauth and /reports
// are hand-written public/ files with no layout, and are not pages anyone
// shares.
const NO_CANONICAL = ['404.html', 'skills/detail/index.html'];
const NOT_ASTRO = /^(oauth|reports)\//;

const pages = (dir = '', out = []) => {
  for (const e of readdirSync(new URL(dir || '.', dist), { withFileTypes: true })) {
    if (e.isDirectory()) pages(`${dir}${e.name}/`, out);
    else if (e.name.endsWith('.html') && !NOT_ASTRO.test(dir)) out.push(`${dir}${e.name}`);
  }
  return out;
};

let all;
beforeAll(() => {
  execSync('npm run build --workspace site', { cwd: new URL('../../', import.meta.url) });
  all = pages();
}, 120000);

describe('link previews', () => {
  it('finds the pages it is meant to be checking', () => {
    for (const p of ['index.html', 'privacy/index.html', 'tester/index.html', 'skills/index.html', '404.html']) {
      expect(all).toContain(p);
    }
    expect(all.filter((p) => /^skills\/[^/]+\/index\.html$/.test(p)).length).toBeGreaterThan(1);
  });

  it('gives every page a title, description, image and large card', () => {
    for (const p of all) {
      const html = read(p);
      const title = html.match(/<title>([^<]*)<\/title>/)[1];
      expect(meta(html, 'property', 'og:title'), p).toBe(unescape(title));
      expect(meta(html, 'property', 'og:description'), p).toBe(meta(html, 'name', 'description'));
      expect(meta(html, 'property', 'og:site_name'), p).toBe('Ari');
      expect(meta(html, 'property', 'og:type'), p).toBe('website');
      expect(meta(html, 'name', 'twitter:card'), p).toBe('summary_large_image');
      expect(meta(html, 'name', 'twitter:image'), p).toBe(meta(html, 'property', 'og:image'));
    }
  });

  it('points og:image at an absolute URL this build actually wrote', () => {
    // Unfurlers fetch og:image on their own, with no page to resolve a relative
    // path against, so it has to be absolute — and on our origin, so it exists.
    for (const p of all) {
      const image = meta(read(p), 'property', 'og:image');
      expect(image, p).toMatch(/^https:\/\/heyari\.dev\//);
      expect(existsSync(local(image)), `${p} -> ${image}`).toBe(true);
    }
  });

  it('declares the size of every card it knows the size of, and gets it right', async () => {
    for (const p of all) {
      const html = read(p);
      const width = meta(html, 'property', 'og:image:width');
      if (!width) continue;
      const { width: w, height: h } = await sharp(readFileSync(local(meta(html, 'property', 'og:image')))).metadata();
      expect([String(w), String(h)], p).toEqual([width, meta(html, 'property', 'og:image:height')]);
    }
  });

  it('names each page by the slash-less URL people share', () => {
    for (const p of all.filter((p) => !NO_CANONICAL.includes(p))) {
      const html = read(p);
      const path = p === 'index.html' ? '/' : `/${p.replace(/\/index\.html$/, '')}`;
      expect(html, p).toContain(`<link rel="canonical" href="https://heyari.dev${path}">`);
      expect(meta(html, 'property', 'og:url'), p).toBe(`https://heyari.dev${path}`);
    }
  });

  it('keeps the 404 and the skill fallback from claiming a URL', () => {
    // Both are served at whatever path was asked for. An og:url naming
    // /404 or /skills/detail would make that the link every unfurl shows.
    for (const p of NO_CANONICAL) {
      const html = read(p);
      expect(html, p).not.toContain('rel="canonical"');
      expect(meta(html, 'property', 'og:url'), p).toBeNull();
    }
  });

  it('ships a brand card small enough for WhatsApp to show', async () => {
    // WhatsApp drops the preview image somewhere past ~300 KB.
    const card = readFileSync(new URL('./og/ari.jpg', dist));
    expect(card.length).toBeLessThan(300 * 1024);
    const { width, height, format } = await sharp(card).metadata();
    expect({ width, height, format }).toEqual({ width: 1200, height: 630, format: 'jpeg' });
  });

  it('builds a JPEG card for every skill with screenshots, same size as the brand one', async () => {
    const skills = JSON.parse(read('./skills.json')).skills
      .filter((s) => Object.values(s.screenshots || {}).some((l) => l.length));
    expect(skills.length).toBeGreaterThan(0);
    for (const s of skills) {
      const card = readFileSync(new URL(`./og/skills/${s.id}.jpg`, dist));
      expect(card.length, s.id).toBeLessThan(300 * 1024);
      const { width, height, format } = await sharp(card).metadata();
      expect({ width, height, format }, s.id).toEqual({ width: 1200, height: 630, format: 'jpeg' });
    }
  });

  it('gives iOS and iMessage an opaque touch icon, since they ignore SVG', async () => {
    expect(read('index.html')).toContain('<link rel="apple-touch-icon" href="/apple-touch-icon.png">');
    const { width, height, hasAlpha } = await sharp(readFileSync(new URL('./apple-touch-icon.png', dist))).metadata();
    expect({ width, height, hasAlpha }).toEqual({ width: 180, height: 180, hasAlpha: false });
  });
});

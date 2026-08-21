import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeAll } from 'vitest';
import { execSync } from 'node:child_process';
import { metaDescription, niceName } from '../src/lib/skills.js';

const dist = new URL('../dist/', import.meta.url);
const read = (p) => readFileSync(new URL(p, dist), 'utf8');
const unescape = (v) => v.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const meta = (html, attr, name) => {
  const m = html.match(new RegExp(`<meta ${attr}="${name}" content="([^"]*)"`));
  return m ? unescape(m[1]) : null;
};

let template, skill, page;
beforeAll(() => {
  execSync('npm run build --workspace site', { cwd: new URL('../../', import.meta.url) });
  template = read('./skills/detail/index.html');
  // Pick a real skill out of the mirror rather than naming one, so retiring a
  // skill doesn't take the test with it.
  skill = JSON.parse(read('./skills.json')).skills.find((s) => s.screenshots && Object.keys(s.screenshots).length);
  page = read(`./skills/${skill.id}/index.html`);
}, 120000);

describe('/skills/detail fallback template', () => {
  it('builds at the cf-rewrite target path with a mount point + loading state', () => {
    expect(template).toContain('id="detail"');
    expect(template).toMatch(/Loading/i);
  });
  it('carries the client script that reads the id and fetches the registry', () => {
    expect(template).toContain('>Ari<');
  });
  it('keeps itself out of the index — it is a routing target, not a page', () => {
    expect(template).toContain('<meta name="robots" content="noindex">');
  });
  it('ships no seeded skill, so the client knows to fetch', () => {
    expect(template).not.toContain('id="skill-data"');
  });
});

describe('prerendered skill page', () => {
  it('titles the page after the skill, not "Skill — Ari"', () => {
    expect(page).toContain(`<title>${niceName(skill.name)} — Ari skill</title>`);
    expect(page).not.toContain('<title>Skill — Ari</title>');
  });
  it('carries the skill description as the meta and OG description', () => {
    const expected = metaDescription(skill);
    expect(expected.length).toBeGreaterThan(0);
    expect(meta(page, 'name', 'description')).toBe(expected);
    expect(meta(page, 'property', 'og:description')).toBe(expected);
  });
  it('points canonical and og:url at the URL people actually share', () => {
    const url = `https://heyari.dev/skills/${skill.id}`;
    expect(page).toContain(`<link rel="canonical" href="${url}">`);
    expect(meta(page, 'property', 'og:url')).toBe(url);
  });
  it('unfurls with the skill first screenshot, served off our own mirror', () => {
    const image = meta(page, 'property', 'og:image');
    expect(image).toMatch(/^https:\/\/heyari\.dev\/registry\/screenshots\//);
    expect(meta(page, 'name', 'twitter:card')).toBe('summary_large_image');
  });
  it('renders the whole detail view server-side, so it reads with JS off', () => {
    expect(page).toContain(`<h1>${niceName(skill.name)}</h1>`);
    expect(page).toContain(skill.id);
    expect(page).toContain('About this skill');
    expect(page).toContain('Skill detail');
    expect(page).not.toMatch(/>Loading…</);
  });
  it('seeds the skill so the client can swap galleries without a fetch', () => {
    const seed = page.match(/<script type="application\/json" id="skill-data">([\s\S]*?)<\/script>/);
    expect(seed).not.toBeNull();
    expect(JSON.parse(seed[1]).id).toBe(skill.id);
  });
});

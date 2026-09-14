import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeAll } from 'vitest';
import { execSync } from 'node:child_process';

let html;
let skills;
beforeAll(() => {
  execSync('npm run build --workspace site', { cwd: new URL('../../', import.meta.url) });
  html = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');
  skills = JSON.parse(readFileSync(new URL('../dist/skills.json', import.meta.url), 'utf8')).skills;
}, 120000);

describe('home skills shelf', () => {
  it('renders every skill in the registry mirror, twice', () => {
    // Two identical copies are what makes the wrap seamless: the animation
    // travels exactly one copy's width and lands on a matching frame.
    expect(skills.length).toBeGreaterThan(0);
    expect((html.match(/class="tile"/g) || []).length).toBe(skills.length * 2);
    expect((html.match(/class="track"/g) || []).length).toBe(2);
  });
  it('hides the duplicate copy from assistive tech and the tab order', () => {
    // Otherwise every skill is announced and tabbed through twice.
    const tracks = html.match(/<div class="track"[^>]*>/g);
    expect(tracks.filter((t) => t.includes('aria-hidden="true"'))).toHaveLength(1);
    expect((html.match(/tabindex="-1"/g) || []).length).toBe(skills.length);
  });
  it('shows a screenshot thumbnail for every skill that has one', () => {
    // Built by getImage, so they land in /_astro at thumbnail size. A tile
    // pointing at /registry/ instead means the page is downloading the full
    // 1080px screenshot to draw it 112px wide.
    const shelf = html.slice(html.indexOf('class="shelf"'), html.indexOf('id="get"'));
    const shots = skills.filter((s) => Object.keys(s.screenshots || {}).length);
    expect(shots.length).toBeGreaterThan(0);
    expect((shelf.match(/class="thumb"/g) || []).length).toBe(skills.length * 2);
    const imgs = [...shelf.matchAll(/<img[^>]*src="([^"]*)"/g)].map((m) => m[1]);
    expect(imgs).toHaveLength(shots.length * 2);
    for (const src of imgs) expect(src.startsWith('/_astro/'), src).toBe(true);
    expect((shelf.match(/class="no-shot"/g) || []).length).toBe((skills.length - shots.length) * 2);
  });
  it('links each card at its own skill page', () => {
    for (const s of skills) expect(html).toContain(`href="/skills/${s.id}"`);
  });
  it('marks each skill on-device or network, matching the registry', () => {
    // "where"/"kind", not "priv"/"badge": those are global names owned by the
    // skills page, and reusing them let bundle order decide the styling.
    const NET_CAPS = new Set(['http', 'authorize', 'media_services', 'navigation']);
    const net = skills.filter((s) => s.type === 'assistant' || (s.capabilities || []).some((c) => NET_CAPS.has(c)));
    expect((html.match(/class="where net"/g) || []).length).toBe(net.length * 2);
    expect((html.match(/class="where local"/g) || []).length).toBe((skills.length - net.length) * 2);
  });
  it('avoids the class names the skills page publishes globally', () => {
    // The skills page styles .card/.badge/.priv/.desc in an `is:global` block,
    // which is site-wide. A scoped rule of the same name ties on specificity,
    // so which one wins depends on bundle order — and that differed between
    // dev and the production build. Reusing any of them here is the bug.
    const shelf = html.slice(html.indexOf('class="shelf"'), html.indexOf('id="get"'));
    for (const owned of ['badge', 'priv', 'desc', 'card']) {
      expect(shelf).not.toMatch(new RegExp(`class="[^"]*\\b${owned}\\b`));
    }
    expect(shelf).toContain('class="kind"');
    expect(shelf).toContain('class="where');
    expect(shelf).toContain('class="blurb"');
  });
  it('carries the registry type as data, never as a class', () => {
    // `type` is a registry value. Spelling it as a class puts it in the same
    // namespace as this component's own class names, and "skill" collided with
    // the card class — every skill badge was styled as a 268px-wide card.
    const shelf = html.slice(html.indexOf('class="shelf"'), html.indexOf('id="get"'));
    for (const s of skills) expect(shelf).toContain(`data-type="${s.type}"`);
    expect(shelf).not.toMatch(/class="kind [a-z]/);
  });
  it('sits below the features section and above the Get Ari card', () => {
    expect(html.indexOf('id="features"')).toBeLessThan(html.indexOf('class="shelf"'));
    expect(html.indexOf('class="shelf"')).toBeLessThan(html.indexOf('id="get"'));
  });
});

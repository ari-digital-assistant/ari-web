import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeAll } from 'vitest';
import { execSync } from 'node:child_process';

let html;
beforeAll(() => {
  execSync('npm run build --workspace site', { cwd: new URL('../../', import.meta.url) });
  html = readFileSync(new URL('../dist/skills/index.html', import.meta.url), 'utf8');
}, 120000);

describe('/skills grid shell', () => {
  it('has the intro heading and a search box', () => {
    expect(html).toContain('A growing shelf of skills');
    expect(html).toContain('type="search"');
  });
  it('has the four filter chips', () => {
    for (const f of ['All', 'Skills', 'Assistants', 'On-device only']) expect(html).toContain(f);
  });
  it('has a grid container and a loading state', () => {
    expect(html).toContain('id="grid"');
    expect(html).toMatch(/Loading skills/i);
  });
  it('has a no-JS fallback pointing at the registry', () => {
    expect(html).toContain('<noscript');
    expect(html).toContain('github.com/ari-digital-assistant/ari-skills');
  });
  it('ships an unscoped .card rule, so runtime-injected cards actually get styled', () => {
    // cardHtml() (src/lib/skills.js) injects cards into #grid via innerHTML at
    // runtime — after Astro's build-time scoped-CSS pass. A scoped `.card`
    // rule compiles to `.card[data-astro-cid-xxx]`, which never matches
    // elements added later, so the card styling must live in an `is:global`
    // block instead. Guard against that regressing.
    const hrefs = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map((m) => m[1]);
    const css = hrefs.map((href) => readFileSync(new URL(`../dist${href}`, import.meta.url), 'utf8')).join('\n');
    expect(css).toMatch(/\.card\{/); // unscoped: no [data-astro-cid...] attached
    expect(css).not.toMatch(/\.card\[data-astro-cid/);
  });
});

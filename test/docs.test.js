import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { describe, it, expect, beforeAll } from 'vitest';
import { execSync } from 'node:child_process';

const root = new URL('../', import.meta.url);
const dist = (p) => new URL(`../docs/.vitepress/dist/${p}`, import.meta.url);
const read = (p) => readFileSync(dist(p), 'utf8');

beforeAll(() => execSync('npm run build --workspace docs', { cwd: root }), 180000);

describe('docs build', () => {
  it('vitepress is pinned to the exact secure version', () => {
    const pkg = JSON.parse(readFileSync(new URL('../docs/package.json', import.meta.url), 'utf8'));
    expect(pkg.devDependencies.vitepress).toBe('2.0.0-alpha.18');
  });
  it('builds the docs home', () => {
    expect(existsSync(dist('index.html'))).toBe(true);
  });
});

describe('user guide', () => {
  it('getting-started + wake-word + skills pages build with their headings', () => {
    expect(read('using/getting-started.html')).toContain('Getting started');
    expect(read('using/wake-word.html')).toContain('Hey Ari');
    expect(read('using/skills.html')).toContain('/skills');
  });
  it('privacy page keeps the honest on-device AND opt-in-cloud story', () => {
    const h = read('using/privacy.html');
    expect(h).toMatch(/on the phone|on your device/i);
    expect(h).toMatch(/ChatGPT|Claude|Gemini/);
    expect(h).toMatch(/optional|only because you asked|only when you say/i);
    expect(h).toMatch(/no analytics|no telemetry/i);
  });
});

describe('develop section', () => {
  it('overview covers the three skill kinds and links to ari-skills', () => {
    const h = read('develop/index.html');
    for (const kind of ['Declarative', 'WASM', 'Assistant']) expect(h).toContain(kind);
    expect(h).toContain('ari-digital-assistant/ari-skills');
  });
  it('first-skill quickstart mentions SKILL.*.md and the post-normalised pattern rule', () => {
    const h = read('develop/first-skill.html');
    expect(h).toMatch(/SKILL\.\w+\.md|SKILL\.en\.md/);
    expect(h).toMatch(/normalis|lowercase/i);
  });
  it('first-skill example manifest includes the required engine field', () => {
    expect(read('develop/first-skill.html')).toMatch(/engine/);
  });
});

describe('docs link previews', () => {
  const meta = (html, attr, name) => {
    const m = html.match(new RegExp(`<meta ${attr}="${name}" content="([^"]*)"`));
    return m ? m[1].replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&') : null;
  };

  it('titles and describes each page as itself, with the shared card', () => {
    const h = read('using/wake-word.html');
    expect(meta(h, 'property', 'og:title')).toBe('The wake word | Ari Docs');
    expect(meta(h, 'property', 'og:description')).toMatch(/Hey Ari/);
    expect(meta(h, 'property', 'og:description')).toBe(meta(h, 'name', 'description'));
    expect(meta(h, 'property', 'og:image')).toBe('https://heyari.dev/og/ari.jpg');
    expect(meta(h, 'name', 'twitter:card')).toBe('summary_large_image');
  });

  it('names pages by the URL cf-rewrite serves them at', () => {
    expect(meta(read('using/wake-word.html'), 'property', 'og:url')).toBe('https://heyari.dev/docs/using/wake-word');
    expect(meta(read('develop/index.html'), 'property', 'og:url')).toBe('https://heyari.dev/docs/develop/');
    expect(meta(read('index.html'), 'property', 'og:url')).toBe('https://heyari.dev/docs/');
    expect(read('using/wake-word.html')).toContain('<link rel="canonical" href="https://heyari.dev/docs/using/wake-word">');
  });

  it('gives every page its own description rather than the site default', () => {
    const fallback = 'Documentation for Ari — the open-source, on-device assistant.';
    for (const p of ['using/getting-started', 'using/wake-word', 'using/skills', 'using/privacy', 'develop/index', 'develop/first-skill']) {
      const d = meta(read(`${p}.html`), 'property', 'og:description');
      expect(d, p).toBeTruthy();
      expect(d, p).not.toBe(fallback);
    }
  });
});

describe('pretty docs URLs', () => {
  // cleanUrls links pages without .html but VitePress still writes flat .html
  // files, so the routing rule and the build output have to agree exactly.
  // Rather than restate a few paths by hand, walk every internal link the
  // build actually emitted and resolve it the way CloudFront will.
  const fnSrc = readFileSync(new URL('../cf-rewrite.js', import.meta.url), 'utf8');
  const handler = new Function(fnSrc + '\nreturn handler;')();
  const distRoot = new URL('../docs/.vitepress/dist/', import.meta.url);

  const htmlFiles = (dir, prefix = '') => readdirSync(new URL(dir, distRoot), { withFileTypes: true })
    .flatMap((e) => (e.isDirectory()
      ? htmlFiles(`${dir}${e.name}/`, `${prefix}${e.name}/`)
      : e.name.endsWith('.html') ? [`${prefix}${e.name}`] : []));

  const resolve = (uri) => {
    const res = handler({ request: { uri } });
    return res.uri ?? handler({ request: { uri: res.headers.location.value } }).uri;
  };

  it('config keeps cleanUrls on', () => {
    expect(readFileSync(new URL('../docs/.vitepress/config.ts', import.meta.url), 'utf8'))
      .toMatch(/cleanUrls:\s*true/);
  });

  it('emits extension-less links, not .html ones', () => {
    const html = read('using/getting-started.html');
    expect(html).toContain('href="/docs/using/wake-word"');
    expect(html).not.toContain('href="/docs/using/wake-word.html"');
  });

  it('every internal docs link the build emitted resolves to a real file', () => {
    const pages = htmlFiles('./');
    expect(pages.length).toBeGreaterThan(0);
    const links = new Set();
    for (const page of pages) {
      for (const m of read(page).matchAll(/href="(\/docs\/[^"#?]*)"/g)) links.add(m[1]);
    }
    // Sanity: the walk found the real nav, not an empty set that trivially passes.
    expect(links.has('/docs/using/getting-started')).toBe(true);
    expect(links.has('/docs/develop/')).toBe(true);

    const broken = [...links]
      .map((href) => [href, resolve(href)])
      .filter(([, uri]) => !existsSync(new URL(`.${uri.slice('/docs'.length)}`, distRoot)));
    expect(broken).toEqual([]);
  });
});

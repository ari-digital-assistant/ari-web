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
});

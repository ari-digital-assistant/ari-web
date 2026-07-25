import { readFileSync, existsSync } from 'node:fs';
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

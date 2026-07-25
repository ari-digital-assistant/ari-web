import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeAll } from 'vitest';
import { execSync } from 'node:child_process';

let html;
beforeAll(() => {
  execSync('npm run build --workspace site', { cwd: new URL('../../', import.meta.url) });
  html = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');
}, 120000);

describe('demo section', () => {
  it('has the section anchor and heading', () => {
    expect(html).toContain('id="demo"');
    expect(html).toContain('Watch Ari do its thing');
  });
  it('offers Android and Linux tabs, Linux marked coming soon', () => {
    expect(html).toContain('Android');
    expect(html).toContain('Linux');
    expect(html).toMatch(/coming soon|Coming soon|Soon/);
  });
  it('shows a video placeholder, not a real embedded video yet', () => {
    expect(html).toContain('Video coming soon');
    expect(html).not.toContain('<video');
  });
});

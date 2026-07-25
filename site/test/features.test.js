import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeAll } from 'vitest';
import { execSync } from 'node:child_process';

let html;
beforeAll(() => {
  execSync('npm run build --workspace site', { cwd: new URL('../../', import.meta.url) });
  html = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');
}, 120000);

describe('features grid', () => {
  it('has the section anchor and all six feature titles', () => {
    expect(html).toContain('id="features"');
    for (const t of ['Hey Ari', 'Skills', 'Speaks your language', 'works offline', 'Talk or type', 'Yours to extend']) {
      expect(html).toContain(t);
    }
  });
  it('the wake-word card makes the on-device (not cloud-mic) point', () => {
    expect(html).toMatch(/on-device|on the phone|no always-on/i);
  });
  it('nav links Features to the home anchor', () => {
    expect(html).toContain('href="/#features"');
  });
});

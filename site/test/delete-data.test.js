import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeAll } from 'vitest';
import { execSync } from 'node:child_process';

let html;
beforeAll(() => {
  execSync('npm run build --workspace site', { cwd: new URL('../../', import.meta.url) });
  html = readFileSync(new URL('../dist/delete-data/index.html', import.meta.url), 'utf8');
}, 120000);

// This page is the data deletion URL on Ari's Play Store listing. Google
// checks three specific things, and each of them is a test here — the page
// can be redesigned freely, but not in a way that drops one of them.
describe('/delete-data', () => {
  it('names the app and the developer, as the listing link must', () => {
    expect(html).toMatch(/Ari/);
    expect(html).toMatch(/Keith Vassallo/);
  });

  it('gives the steps, prominently and in order', () => {
    expect(html).toMatch(/Settings/);
    expect(html).toMatch(/My Reports/);
    expect(html).toMatch(/Withdraw/i);
    // Numbered rail, not a wall of prose.
    expect(html).toMatch(/dd-num/);
  });

  it('offers a route for someone who no longer has the phone', () => {
    // The withdrawal token lives on the device, so this is the only way back
    // for a reinstall or a new handset. Without it the page describes a
    // deletion route half the people reading it cannot use.
    expect(html).toMatch(/mailto:/);
  });

  it('says what is deleted and what is kept', () => {
    expect(html).toMatch(/Erased/i);
    expect(html).toMatch(/Kept/i);
  });

  it('states the retention period', () => {
    expect(html).toMatch(/90 days/);
  });

  it('REFUSES to imply a withdrawal erases the GitHub issue', () => {
    // Same promise the app and the privacy page make. All three have to
    // agree, and this is the one a Play reviewer reads.
    expect(html).toMatch(/edit history/);
  });
});

import { readFileSync, readdirSync } from 'node:fs';
import { describe, it, expect, beforeAll } from 'vitest';
import { execSync } from 'node:child_process';

let html;
let home;
// Astro inlines a small page script and bundles a larger one, and which side
// of that line this page falls on is not worth a test being brittle about.
let shipped;
beforeAll(() => {
  execSync('npm run build --workspace site', { cwd: new URL('../../', import.meta.url) });
  const dist = new URL('../dist/', import.meta.url);
  html = readFileSync(new URL('tester/index.html', dist), 'utf8');
  home = readFileSync(new URL('index.html', dist), 'utf8');
  const astro = new URL('_astro/', dist);
  const bundles = readdirSync(astro)
    .filter((f) => f.endsWith('.js'))
    .map((f) => readFileSync(new URL(f, astro), 'utf8'));
  shipped = [html, ...bundles].join('\n');
}, 180000);

describe('tester page', () => {
  it('is reachable from the home hero', () => {
    expect(home).toContain('href="/tester"');
    expect(home).toContain('Become a tester');
  });

  it('asks for the Google account email, which is the only thing that unblocks anything', () => {
    expect(html).toContain('Google account email');
    expect(html).toMatch(/<input[^>]+id="f-email"[^>]+type="email"/);
    expect(html).toMatch(/<input[^>]+id="f-email"[^>]*\srequired/);
  });

  it('warns about the mistake that actually breaks the opt-in link', () => {
    // Somebody who gives an address they are not signed in with on the test
    // phone gets a "page does not exist" and no clue why.
    expect(html).toContain('signed in to the Play Store');
  });

  it('requires the consent tickbox and names who holds the address', () => {
    expect(html).toMatch(/<input[^>]+id="f-consent"[^>]+type="checkbox"[^>]*\srequired/);
    expect(html).toContain('Keith Vassallo holding my email address');
  });

  it('carries the honeypot, hidden from people and from screen readers', () => {
    expect(html).toContain('aria-hidden="true"');
    expect(html).toMatch(/<input[^>]+id="f-website"/);
    expect(html).toContain('tabindex="-1"');
  });

  it('posts to the endpoint the Lambda is routed on', () => {
    expect(shipped).toContain('/api/tester');
  });

  it('gives a way through when JavaScript or the POST fails', () => {
    expect(html).toContain('<noscript>');
    expect(html).toContain('mailto:keith@vassallo.cloud');
    // The failure path has to offer the fallback too, not just apologise.
    expect(shipped).toContain('keith@vassallo.cloud instead');
  });

  it('mints and solves its challenge against our own endpoint', () => {
    expect(shipped).toContain('/api/tester/challenge');
  });

  it('uses no third-party CAPTCHA, on the one page that sits next to the privacy notice', () => {
    // The whole site's argument is that nothing phones home. A Google,
    // Cloudflare or hCaptcha widget here would quietly undo that.
    expect(shipped).not.toMatch(/recaptcha|hcaptcha|turnstile|challenges\.cloudflare|friendlycaptcha/i);
    expect(html).toContain('No third-party CAPTCHA');
  });

  it('links to the privacy section that explains the address', () => {
    expect(html).toContain('/privacy/#testing');
  });

  it('makes no promise about a store listing that does not exist yet', () => {
    expect(html).not.toMatch(/play\.google\.com|f-droid\.org\/[a-z]/i);
  });
});

describe('the site stops contradicting itself about what is held', () => {
  it('privacy has the testing section the tester page links to', () => {
    const privacy = readFileSync(new URL('../dist/privacy/index.html', import.meta.url), 'utf8');
    expect(privacy).toContain('id="testing"');
    expect(privacy).toContain('If you apply to be a tester');
  });

  it('delete-data no longer claims a bug report is the only thing held', () => {
    const dd = readFileSync(new URL('../dist/delete-data/index.html', import.meta.url), 'utf8');
    expect(dd).toContain('At most two things');
    expect(dd).toContain('If you applied to be a tester');
    expect(dd).toContain('/privacy/#testing');
  });
});

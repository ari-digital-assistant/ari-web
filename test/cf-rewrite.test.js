import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

// Load the ACTUAL CloudFront Function source (ES5.1, no exports) and expose handler.
const src = readFileSync(new URL('../cf-rewrite.js', import.meta.url), 'utf8');
const handler = new Function(src + '\nreturn handler;')();
const run = (uri) => handler({ request: { uri } }).uri;
const redirect = (uri) => {
  const res = handler({ request: { uri } });
  return { status: res.statusCode, to: res.headers.location.value };
};

describe('cf-rewrite CloudFront Function', () => {
  it('rewrites a dotted skill deep-link to the detail template', () => {
    expect(run('/skills/dev.heyari.weather')).toBe('/skills/detail/index.html');
    expect(run('/skills/dev.heyari.homeassistant')).toBe('/skills/detail/index.html');
  });
  it('rewrites a dotless skill deep-link too', () => {
    // The dotted case survives by way of the explicit skills branch, but an id
    // without dots would fall through to the directory heuristic and be sent to
    // /skills/coinflip/index.html — a key that doesn't exist, which a private
    // bucket reports as 403 rather than 404.
    expect(run('/skills/coinflip')).toBe('/skills/detail/index.html');
    expect(run('/skills/coinflip/')).toBe('/skills/detail/index.html');
  });
  it('serves the skills index, not the detail template', () => {
    expect(run('/skills')).toBe('/skills/index.html');
    expect(run('/skills/')).toBe('/skills/index.html');
  });
  it('never rewrites the detail template onto itself', () => {
    expect(run('/skills/detail/index.html')).toBe('/skills/detail/index.html');
    expect(run('/skills/detail/')).toBe('/skills/detail/index.html');
  });
  it('appends index.html for directory-style routes', () => {
    expect(run('/')).toBe('/index.html');
    expect(run('/features')).toBe('/features/index.html');
    expect(run('/privacy/')).toBe('/privacy/index.html');
  });
  it('maps a clean docs URL onto the flat .html file VitePress emits', () => {
    // cleanUrls only changes how VitePress LINKS pages — the build still writes
    // using/getting-started.html, so the dir-index rule would ask S3 for
    // using/getting-started/index.html and get a 403 off the private bucket.
    expect(run('/docs/using/getting-started')).toBe('/docs/using/getting-started.html');
    expect(run('/docs/develop/first-skill')).toBe('/docs/develop/first-skill.html');
  });
  it('still serves the docs section indexes, which really are index.html', () => {
    expect(run('/docs')).toBe('/docs/index.html');
    expect(run('/docs/')).toBe('/docs/index.html');
    expect(run('/docs/develop/')).toBe('/docs/develop/index.html');
  });
  it('301s the pre-cleanUrls .html spellings onto the pretty ones', () => {
    // The flat files are still in the bucket, so these would otherwise serve a
    // 200 at a second URL for the same page.
    expect(redirect('/docs/using/skills.html')).toEqual({ status: 301, to: '/docs/using/skills' });
    expect(redirect('/docs/index.html')).toEqual({ status: 301, to: '/docs/' });
    expect(redirect('/docs/develop/index.html')).toEqual({ status: 301, to: '/docs/develop/' });
  });
  it('leaves docs assets alone — they already have extensions', () => {
    expect(run('/docs/assets/style.DD-ZdeMm.css')).toBe('/docs/assets/style.DD-ZdeMm.css');
    expect(run('/docs/vp-icons.css')).toBe('/docs/vp-icons.css');
    expect(run('/docs/favicon.svg')).toBe('/docs/favicon.svg');
  });
  it('leaves fingerprinted asset files untouched', () => {
    expect(run('/_astro/app.a1b2c3.css')).toBe('/_astro/app.a1b2c3.css');
    expect(run('/.well-known/assetlinks.json')).toBe('/.well-known/assetlinks.json');
  });
  it('serves the mirrored registry straight off the bucket', () => {
    // The screenshot mirror and the index mirror are plain keys; nothing here
    // should touch them, least of all the /skills/<id> branch.
    expect(run('/registry/screenshots/dev.heyari.timer-0.2.0/android/01-timer.webp'))
      .toBe('/registry/screenshots/dev.heyari.timer-0.2.0/android/01-timer.webp');
    expect(run('/skills.json')).toBe('/skills.json');
  });
});

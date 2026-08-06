import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

// Load the ACTUAL CloudFront Function source (ES5.1, no exports) and expose handler.
const src = readFileSync(new URL('../cf-rewrite.js', import.meta.url), 'utf8');
const handler = new Function(src + '\nreturn handler;')();
const run = (uri) => handler({ request: { uri } }).uri;

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
  it('leaves fingerprinted asset files untouched', () => {
    expect(run('/_astro/app.a1b2c3.css')).toBe('/_astro/app.a1b2c3.css');
    expect(run('/.well-known/assetlinks.json')).toBe('/.well-known/assetlinks.json');
  });
});

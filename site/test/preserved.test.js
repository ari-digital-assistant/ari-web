import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, it, expect, beforeAll } from 'vitest';
import { execSync } from 'node:child_process';

const root = new URL('../../', import.meta.url);
const sha = (p) => createHash('sha256').update(readFileSync(new URL(p, import.meta.url))).digest('hex');

beforeAll(() => execSync('npm run build --workspace site', { cwd: root }), 120000);

describe('preserved OAuth + App-Link surface', () => {
  it('assetlinks.json survives the build byte-for-byte', () => {
    expect(sha('../dist/.well-known/assetlinks.json'))
      .toBe(sha('../public/.well-known/assetlinks.json'));
  });
  it('oauth pages survive the build byte-for-byte', () => {
    expect(sha('../dist/oauth/client/index.html')).toBe(sha('../public/oauth/client/index.html'));
    expect(sha('../dist/oauth/callback/index.html')).toBe(sha('../public/oauth/callback/index.html'));
  });
  it('assetlinks still declares the Ari package', () => {
    const j = JSON.parse(readFileSync(new URL('../dist/.well-known/assetlinks.json', import.meta.url), 'utf8'));
    expect(j[0].target.package_name).toBe('dev.heyari.ari');
  });

  it('carries a fingerprint for every channel Ari ships through', () => {
    // One per signing certificate, and a missing one fails silently: Android
    // reports `heyari.dev: legacy_failure`, declines to hand the OAuth
    // callback to the app, and the browser just sits there. Nothing in the
    // app says why. Losing an entry here is therefore expensive to diagnose
    // and cheap to prevent.
    const j = JSON.parse(readFileSync(new URL('../dist/.well-known/assetlinks.json', import.meta.url), 'utf8'));
    const fps = j[0].target.sha256_cert_fingerprints;
    expect(fps).toContain(
      // Play app signing — every install from the store. Google holds this key.
      '6C:D9:DF:0C:CF:A2:99:46:B7:09:48:33:06:4B:86:BF:68:09:42:FB:00:49:97:E9:21:71:66:70:8E:12:90:4A'
    );
    expect(fps).toContain(
      // Upload key — the beta and release APKs built and sideloaded directly.
      '17:39:84:77:CD:A8:12:6D:DB:3D:38:82:63:65:C2:2F:2B:31:90:31:F6:F5:32:0F:4E:39:68:2B:5F:A7:E3:46'
    );
    expect(fps.every((f) => /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(f))).toBe(true);
  });
  it('favicon.svg is present in the built output', () => {
    expect(existsSync(new URL('../dist/favicon.svg', import.meta.url))).toBe(true);
  });
});

describe('security.txt', () => {
  const text = () =>
    readFileSync(new URL('../dist/.well-known/security.txt', import.meta.url), 'utf8');

  const field = (name) =>
    text().split('\n').find((l) => l.startsWith(`${name}:`))?.slice(name.length + 1).trim();

  it('survives the build byte-for-byte', () => {
    expect(sha('../dist/.well-known/security.txt'))
      .toBe(sha('../public/.well-known/security.txt'));
  });

  it('carries the two fields RFC 9116 requires', () => {
    expect(field('Contact')).toBe('mailto:security@heyari.dev');
    expect(field('Expires')).toBeTruthy();
  });

  it('names itself as canonical, so a copy found elsewhere is obviously not ours', () => {
    expect(field('Canonical')).toBe('https://heyari.dev/.well-known/security.txt');
  });

  it('has not expired, and will fail here a month before it does', () => {
    // The whole trap with security.txt is that Expires is mandatory, a year
    // out, and nothing tells you when it lapses — the file just quietly stops
    // being valid. This is that reminder: the suite goes red with a month in
    // hand, which is plenty of time to push a new date.
    const expires = new Date(field('Expires'));
    expect(Number.isNaN(expires.getTime())).toBe(false);
    const monthsNotice = 30 * 24 * 60 * 60 * 1000;
    expect(expires.getTime() - Date.now()).toBeGreaterThan(monthsNotice);
  });

  it('promises no language nobody here reads', () => {
    expect(field('Preferred-Languages')).toBe('en');
  });
});

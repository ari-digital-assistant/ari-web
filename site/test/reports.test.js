import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, it, expect, beforeAll } from 'vitest';
import { execSync } from 'node:child_process';

const root = new URL('../../', import.meta.url);
const sha = (p) => createHash('sha256').update(readFileSync(new URL(p, import.meta.url))).digest('hex');
const source = () => readFileSync(new URL('../public/reports/index.html', import.meta.url), 'utf8');

beforeAll(() => execSync('npm run build --workspace site', { cwd: root }), 120000);

describe('the maintainer reports page', () => {
  it('survives the build byte-for-byte, like the other hand-written surfaces', () => {
    expect(sha('../dist/reports/index.html')).toBe(sha('../public/reports/index.html'));
  });

  it('asks search engines to stay away', () => {
    // Not a security control — the API is — but there is no reason for a page
    // about other people's diagnostic data to turn up in results.
    expect(source()).toMatch(/<meta name="robots" content="noindex, nofollow">/);
  });

  it('points sign-in at the auth endpoint rather than at GitHub directly', () => {
    // Going straight to GitHub would skip the signed state the callback
    // insists on, so the flow has to start on our side.
    expect(source()).toContain('href="/api/bug/auth/start"');
    expect(source()).not.toContain('github.com/login/oauth/authorize');
  });

  it('carries no client id, secret or token', () => {
    const html = source();
    expect(html).not.toMatch(/Iv1\.|Iv23/);
    expect(html).not.toMatch(/client_secret/i);
    expect(html).not.toMatch(/ghp_|github_pat_/);
  });

  it('never names the bucket or an AWS host', () => {
    // Asset URLs are minted per request by the Lambda; a bucket name baked
    // into the page would outlive every one of them.
    expect(source()).not.toMatch(/amazonaws|heyari-bug-reports/i);
  });

  it('builds its DOM from text rather than innerHTML', () => {
    // Report descriptions and private notes are written by other people. The
    // page renders them with textContent throughout, so a report containing
    // markup is shown, not run.
    expect(source()).not.toMatch(/innerHTML/);
  });

  it('sends cookies with its API calls, or the session is pointless', () => {
    expect(source()).toContain("credentials: 'same-origin'");
  });

  it('reads as signed out when the API says 401', () => {
    expect(source()).toContain('res.status === 401');
    expect(source()).toContain('renderSignedOut');
  });

  it('says plainly that asset links expire', () => {
    expect(source()).toMatch(/links stop working in/);
  });

  it('defines every colour it uses in both schemes', () => {
    const html = source();
    const light = html.slice(html.indexOf(':root{'), html.indexOf('@media'));
    const dark = html.slice(html.indexOf('@media'));
    for (const token of ['--bg', '--surface', '--ink', '--muted', '--hair', '--sun', '--danger']) {
      expect(light, `${token} missing from the light palette`).toContain(`${token}:`);
      expect(dark, `${token} missing from the dark palette`).toContain(`${token}:`);
    }
  });
});

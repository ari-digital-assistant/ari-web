import { describe, it, expect } from 'vitest';
import {
  sign,
  verify,
  authorizeUrl,
  parseCookies,
  cookie,
  clearCookie,
  mayReadReports,
  newNonce,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  STATE_TTL_SECONDS,
} from '../functions/bugreport/auth.mjs';
import { route } from '../functions/bugreport/report.mjs';

const SECRET = 'a-test-signing-secret';
const NOW = 1_756_819_682;

describe('signed tokens', () => {
  it('round-trips a payload', () => {
    const token = sign(SECRET, { login: 'keith', exp: NOW + 60 });
    expect(verify(SECRET, token, NOW)).toMatchObject({ login: 'keith' });
  });

  it('refuses a token signed with a different secret', () => {
    const token = sign('another-secret', { login: 'keith', exp: NOW + 60 });
    expect(verify(SECRET, token, NOW)).toBeNull();
  });

  it('refuses a tampered payload', () => {
    const token = sign(SECRET, { login: 'keith', exp: NOW + 60 });
    const forged = Buffer.from(JSON.stringify({ login: 'root', exp: NOW + 60 })).toString('base64url');
    expect(verify(SECRET, `${forged}.${token.split('.').pop()}`, NOW)).toBeNull();
  });

  it('refuses an expired token', () => {
    const token = sign(SECRET, { login: 'keith', exp: NOW - 1 });
    expect(verify(SECRET, token, NOW)).toBeNull();
  });

  it('refuses a payload with no expiry at all', () => {
    const body = Buffer.from(JSON.stringify({ login: 'keith' })).toString('base64url');
    const token = sign(SECRET, { login: 'keith' });
    expect(verify(SECRET, token, NOW)).toBeNull();
    expect(verify(SECRET, `${body}.`, NOW)).toBeNull();
  });

  it('refuses rubbish without throwing', () => {
    for (const bad of [undefined, null, '', 'nodot', '.', 'a.b.c', 42, {}]) {
      expect(verify(SECRET, bad, NOW)).toBeNull();
    }
  });

  it('mints a fresh nonce every time', () => {
    const nonces = new Set(Array.from({ length: 200 }, newNonce));
    expect(nonces.size).toBe(200);
  });
});

describe('the authorize redirect', () => {
  it('carries the client id, the callback and the state', () => {
    const url = new URL(authorizeUrl('Iv1.abc', 'https://heyari.dev/api/bug/auth/callback', 'st'));
    expect(url.origin + url.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(url.searchParams.get('client_id')).toBe('Iv1.abc');
    expect(url.searchParams.get('redirect_uri')).toBe('https://heyari.dev/api/bug/auth/callback');
    expect(url.searchParams.get('state')).toBe('st');
  });

  it('never carries the client secret', () => {
    const url = authorizeUrl('Iv1.abc', 'https://heyari.dev/cb', sign(SECRET, { exp: NOW + 60 }));
    expect(url).not.toContain('secret');
  });
});

describe('cookies', () => {
  it('parses what a browser sends', () => {
    const jar = parseCookies('ari_reports_session=abc.def; other=1');
    expect(jar[SESSION_COOKIE]).toBe('abc.def');
    expect(jar.other).toBe('1');
  });

  it('survives an absent or malformed header', () => {
    expect(parseCookies(undefined)).toEqual({});
    expect(parseCookies('')).toEqual({});
    expect(parseCookies('novalue')).toEqual({});
  });

  it('sets the flags that keep a session out of reach of script', () => {
    const header = cookie(SESSION_COOKIE, 'value', SESSION_TTL_SECONDS);
    expect(header).toContain('HttpOnly');
    expect(header).toContain('Secure');
    // Lax, not Strict: Strict drops the cookie on the redirect back from
    // GitHub, which is the one moment it has to survive.
    expect(header).toContain('SameSite=Lax');
    expect(header).toContain(`Max-Age=${SESSION_TTL_SECONDS}`);
  });

  it('expires a cookie by zeroing its age', () => {
    expect(clearCookie(SESSION_COOKIE)).toContain('Max-Age=0');
  });

  it('keeps the state cookie short-lived', () => {
    expect(STATE_TTL_SECONDS).toBeLessThan(SESSION_TTL_SECONDS);
  });
});

describe('who may read reports', () => {
  it('admits write access in any of its forms', () => {
    expect(mayReadReports({ permissions: { push: true } })).toBe(true);
    expect(mayReadReports({ permissions: { maintain: true } })).toBe(true);
    expect(mayReadReports({ permissions: { admin: true } })).toBe(true);
  });

  it('refuses read-only access, which any stranger has on a public repo', () => {
    expect(mayReadReports({ permissions: { pull: true, push: false, admin: false } })).toBe(false);
  });

  it('refuses anything it does not understand rather than assuming the best', () => {
    expect(mayReadReports(undefined)).toBe(false);
    expect(mayReadReports({})).toBe(false);
    expect(mayReadReports({ permissions: null })).toBe(false);
    expect(mayReadReports({ message: 'Not Found' })).toBe(false);
  });
});

describe('routing the maintainer endpoints', () => {
  it('separates them from the reporter endpoints by method', () => {
    expect(route('/api/bug')).toEqual({ action: 'create', method: 'POST' });
    expect(route('/api/bug/auth/start')).toEqual({ action: 'auth-start', method: 'GET' });
    expect(route('/api/bug/auth/callback')).toEqual({ action: 'auth-callback', method: 'GET' });
    expect(route('/api/bug/auth/logout')).toEqual({ action: 'auth-logout', method: 'GET' });
    expect(route('/api/bug/reports')).toEqual({ action: 'list-reports', method: 'GET' });
    expect(route('/api/bug/reports/r_abc')).toEqual({
      action: 'read-report', id: 'r_abc', method: 'GET',
    });
  });

  it('does not let a report id masquerade as an auth route', () => {
    expect(route('/api/bug/auth/start/extra')).toBeNull();
    expect(route('/api/bug/reports/r_abc/extra')).toBeNull();
  });

  it('still refuses everything else', () => {
    expect(route('/api/report')).toBeNull();
    expect(route('/api/bug/r_abc')).toBeNull();
  });
});

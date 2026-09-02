// Maintainer sign-in for the reports view. Pure functions only — the GitHub
// round trips live in index.mjs, so everything that decides who gets in is
// testable without a network.

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const AUTHORIZE = 'https://github.com/login/oauth/authorize';

/** A session lasts a working day and no longer. Re-signing in is one click. */
export const SESSION_TTL_SECONDS = 8 * 60 * 60;

/** Long enough to finish a redirect, short enough that a stolen one is useless. */
export const STATE_TTL_SECONDS = 10 * 60;

export const SESSION_COOKIE = 'ari_reports_session';
export const STATE_COOKIE = 'ari_reports_state';

const b64 = (value) => Buffer.from(value).toString('base64url');

/**
 * `<payload>.<mac>`, where the payload is base64url JSON.
 *
 * Deliberately not a JWT: a JWT would mean a library, an algorithm field a
 * caller could argue with, and a spec's worth of edge cases, to carry two
 * fields between two endpoints we both own.
 */
export function sign(secret, payload) {
  const body = b64(JSON.stringify(payload));
  const mac = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${mac}`;
}

/**
 * The payload if the signature holds and it has not expired, otherwise null.
 *
 * Compared through a second HMAC so the comparison is constant-time even when
 * the two strings differ in length, which `timingSafeEqual` will not accept.
 */
export function verify(secret, token, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (typeof token !== 'string') return null;
  const cut = token.lastIndexOf('.');
  if (cut <= 0) return null;
  const body = token.slice(0, cut);
  const mac = token.slice(cut + 1);
  const expected = createHmac('sha256', secret).update(body).digest('base64url');
  const wrap = (v) => createHmac('sha256', secret).update(v).digest();
  if (!timingSafeEqual(wrap(mac), wrap(expected))) return null;

  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!Number.isFinite(payload?.exp) || payload.exp <= nowSeconds) return null;
  return payload;
}

export const newNonce = () => randomBytes(16).toString('base64url');

export function authorizeUrl(clientId, redirectUri, state) {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
  });
  return `${AUTHORIZE}?${params}`;
}

/** Cookies as sent by a browser: `a=1; b=2`, or already split into a list. */
export function parseCookies(source) {
  const parts = Array.isArray(source)
    ? source
    : typeof source === 'string' ? source.split(';') : [];
  const out = {};
  for (const part of parts) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}

/**
 * The request's cookies, whichever way the gateway chose to deliver them.
 *
 * An HTTP API on payload format 2.0 puts them in `event.cookies` as an array
 * and removes the Cookie header altogether — so reading the header alone finds
 * nothing, every time, and the sign-in refuses itself with "that did not come
 * from here". The header fallback is for a local invoke or a format 1.0 event.
 */
export const cookiesOf = (event) =>
  parseCookies(event?.cookies ?? event?.headers?.cookie ?? event?.headers?.Cookie ?? []);

/**
 * HttpOnly so script cannot read it, Secure because the site is HTTPS only,
 * and SameSite=Lax rather than Strict — Strict would drop the cookie on the
 * redirect back from GitHub, which is the one moment it has to survive.
 */
export function cookie(name, value, maxAgeSeconds) {
  const attrs = [
    `${name}=${value}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ];
  return attrs.join('; ');
}

export const clearCookie = (name) => cookie(name, '', 0);

/**
 * Whether this user may read other people's diagnostic data.
 *
 * The question is "can you act on a bug report", not "are you in the org", and
 * write access to the repository the reports land in answers it exactly. It
 * also needs no permission the App does not already hold: a public repo is
 * readable by anyone, but the `permissions` block comes back scoped to the
 * signed-in user, so a stranger sees pull-only and is refused.
 */
export function mayReadReports(repository) {
  const p = repository?.permissions;
  return Boolean(p?.admin || p?.maintain || p?.push);
}

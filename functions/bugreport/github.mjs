// Talking to GitHub as the ari-bugbot App. No SDK: a GitHub App JWT is a
// signed header, payload and RS256 signature, all of which node:crypto does,
// and the REST calls are three fetches.

import { createSign, createPrivateKey } from 'node:crypto';

const API = 'https://api.github.com';
const UA = 'ari-bugbot';

const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');

/**
 * A GitHub App JWT, good for ten minutes.
 *
 * `iat` is back-dated a minute on purpose: GitHub rejects a token whose issued
 * time is even slightly ahead of its own clock, and "slightly" includes the
 * drift a Lambda host can carry.
 */
export function appJwt({ appId, privateKey }, now = Date.now()) {
  const seconds = Math.floor(now / 1000);
  const header = b64url({ alg: 'RS256', typ: 'JWT' });
  const payload = b64url({ iat: seconds - 60, exp: seconds + 540, iss: appId });
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${payload}`);
  const signature = signer.sign(createPrivateKey(privateKey)).toString('base64url');
  return `${header}.${payload}.${signature}`;
}

async function call(path, { token, method = 'GET', body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': UA,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`GitHub ${method} ${path} -> ${res.status}: ${payload.message ?? ''}`);
    err.status = res.status;
    throw err;
  }
  return payload;
}

/**
 * An installation token, cached across warm invocations.
 *
 * Tokens last an hour; this drops them after fifty minutes so a request never
 * starts with one that expires mid-flight. The cache lives in module scope,
 * which is per-container — a cold start simply mints another.
 */
let cached = { token: null, expiresAt: 0 };

export async function installationToken(credentials, now = Date.now()) {
  if (cached.token && cached.expiresAt > now) return cached.token;
  const jwt = appJwt(credentials, now);
  const res = await call(`/app/installations/${credentials.installationId}/access_tokens`, {
    token: jwt,
    method: 'POST',
  });
  cached = { token: res.token, expiresAt: now + 50 * 60 * 1000 };
  return res.token;
}

/** Only for tests — the module-scope cache would otherwise leak between them. */
export function resetTokenCache() {
  cached = { token: null, expiresAt: 0 };
}

export const createIssue = (token, repo, { title, body, labels }) =>
  call(`/repos/${repo}/issues`, { token, method: 'POST', body: { title, body, labels } });

export const updateIssue = (token, repo, number, fields) =>
  call(`/repos/${repo}/issues/${number}`, { token, method: 'PATCH', body: fields });

export const issueComments = (token, repo, number) =>
  call(`/repos/${repo}/issues/${number}/comments?per_page=1`, { token });

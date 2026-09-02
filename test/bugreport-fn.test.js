import { describe, it, expect } from 'vitest';
import {
  validate,
  withinLimits,
  issueTitle,
  issueBody,
  redactedBody,
  objectKey,
  hashToken,
  newReportId,
  newDeleteToken,
  rateDay,
  expiresAt,
  rateExpiresAt,
  LIMITS,
  RETENTION_DAYS,
  MAX_BODY_BYTES,
  route,
  originSecretOk,
} from '../functions/bugreport/report.mjs';

import { appJwt } from '../functions/bugreport/github.mjs';
import { generateKeyPairSync, createVerify } from 'node:crypto';

const good = () => ({
  installId: 'a3f1c9d2-4e5b-4a71-9f00-1c2d3e4f5a6b',
  description: "Ari couldn't reach Home Assistant",
  app: { version: '0.9.3', buildType: 'beta', commit: 'a1b2c3d', engineVersion: '0.7.1', locale: 'en' },
  device: { model: 'Pixel 8', androidVersion: '16' },
});

describe('payload validation', () => {
  it('accepts the minimum a report needs', () => {
    const r = validate(good());
    expect(r.ok).toBe(true);
    expect(r.report.description).toBe("Ari couldn't reach Home Assistant");
    expect(r.report.attachments).toEqual([]);
    expect(r.report.totalBytes).toBe(0);
  });

  it('rejects a body that is not an object', () => {
    expect(validate(null).ok).toBe(false);
    expect(validate([]).ok).toBe(false);
    expect(validate('nope').ok).toBe(false);
  });

  it('requires an install id, a description, an app and a device', () => {
    for (const missing of ['installId', 'description', 'app', 'device']) {
      const body = good();
      delete body[missing];
      const r = validate(body);
      expect(r.ok, missing).toBe(false);
      expect(r.reason.toLowerCase(), missing).toContain(missing.toLowerCase());
    }
  });

  it('never reflects caller input in the failure reason', () => {
    const r = validate({ ...good(), installId: '<script>alert(1)</script>'.repeat(10) });
    expect(r.ok).toBe(false);
    expect(r.reason).not.toContain('script');
  });

  it('keeps the private note out of the public fields but retains it', () => {
    const { report } = validate({ ...good(), privateNote: 'my HA is at home.example' });
    expect(report.privateNote).toBe('my HA is at home.example');
    expect(issueBody(report, 'r_1', 'now', 'https://x/reports')).not.toContain('home.example');
  });

  it('defaults every optional field to null rather than undefined', () => {
    const { report } = validate(good());
    expect(report.privateNote).toBeNull();
    expect(report.stackTrace).toBeNull();
    expect(report.setup.assistant).toBeNull();
    expect(report.device.fingerprint).toBeNull();
    expect(report.device.batteryExempt).toBeNull();
  });

  it('rejects an unknown attachment kind', () => {
    const r = validate({ ...good(), attachments: [{ kind: 'contacts', bytes: 10 }] });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('unknown attachment kind');
  });

  it('rejects a duplicate attachment kind', () => {
    const r = validate({
      ...good(),
      attachments: [
        { kind: 'logcat', bytes: 10 },
        { kind: 'logcat', bytes: 20 },
      ],
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('duplicate attachment kind');
  });

  it('rejects an attachment with no size, so nothing is signed blind', () => {
    expect(validate({ ...good(), attachments: [{ kind: 'logcat' }] }).ok).toBe(false);
    expect(validate({ ...good(), attachments: [{ kind: 'logcat', bytes: 0 }] }).ok).toBe(false);
    expect(validate({ ...good(), attachments: [{ kind: 'logcat', bytes: -5 }] }).ok).toBe(false);
  });

  it('rejects a report over the per-report byte cap', () => {
    const r = validate({
      ...good(),
      attachments: [{ kind: 'all-audio', bytes: LIMITS.bytesPerReport + 1 }],
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/per-report size limit/);
  });

  it('sums the declared bytes so the rate limiter has a number to work with', () => {
    const { report } = validate({
      ...good(),
      attachments: [
        { kind: 'logcat', bytes: 1000 },
        { kind: 'screenshot', bytes: 2000 },
      ],
    });
    expect(report.totalBytes).toBe(3000);
  });

  it('drops oversized text rather than truncating it', () => {
    const r = validate({ ...good(), description: 'x'.repeat(LIMITS.description + 1) });
    expect(r.ok).toBe(false);
  });
});

describe('rate limiting', () => {
  it('allows an install with no history', () => {
    expect(withinLimits(undefined, 1000).ok).toBe(true);
    expect(withinLimits({ reports: 0, bytes: 0 }, 1000).ok).toBe(true);
  });

  it('allows the last report of the day', () => {
    const counters = { reports: LIMITS.reportsPerInstallPerDay - 1, bytes: 0 };
    expect(withinLimits(counters, 1000).ok).toBe(true);
  });

  it('blocks one report past the daily count', () => {
    const counters = { reports: LIMITS.reportsPerInstallPerDay, bytes: 0 };
    const r = withinLimits(counters, 1000);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/daily report limit/);
  });

  it('blocks an upload that would cross the daily byte budget', () => {
    const counters = { reports: 1, bytes: LIMITS.bytesPerInstallPerDay - 100 };
    const r = withinLimits(counters, 101);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/daily upload limit/);
  });

  it('allows an upload that exactly fills the budget', () => {
    const counters = { reports: 1, bytes: LIMITS.bytesPerInstallPerDay - 100 };
    expect(withinLimits(counters, 100).ok).toBe(true);
  });
});

describe('the public issue', () => {
  const filed = '2026-09-02T14:13:41+02:00';
  const base = 'https://heyari.dev/reports';

  it('titles the issue from the first line of the description', () => {
    const { report } = validate({ ...good(), description: 'Lights fail\nEvery time' });
    expect(issueTitle(report)).toBe('Lights fail');
  });

  it('truncates a very long title', () => {
    const { report } = validate({ ...good(), description: 'y'.repeat(200) });
    expect(issueTitle(report).length).toBe(80);
    expect(issueTitle(report).endsWith('...')).toBe(true);
  });

  it('carries the build, device and skill detail', () => {
    const { report } = validate({
      ...good(),
      skills: [{ id: 'dev.heyari.home-assistant', version: '0.4.1' }],
      device: { model: 'Pixel 8', androidVersion: '16', batteryExempt: true, network: 'wifi' },
    });
    const body = issueBody(report, 'r_abc', filed, base);
    expect(body).toContain('Ari 0.9.3 (beta, a1b2c3d)');
    expect(body).toContain('engine 0.7.1');
    expect(body).toContain('Pixel 8 · Android 16');
    expect(body).toContain('dev.heyari.home-assistant 0.4.1');
    expect(body).toContain('Battery optimisation exempt: yes');
  });

  it('says when battery state is unknown rather than implying no', () => {
    const { report } = validate(good());
    expect(issueBody(report, 'r_abc', filed, base)).toContain('Battery optimisation exempt: unknown');
  });

  it('publishes the stack trace, because it carries no personal data', () => {
    const { report } = validate({
      ...good(),
      stackTrace: 'java.lang.IllegalStateException: no active session',
    });
    expect(issueBody(report, 'r_abc', filed, base)).toContain('java.lang.IllegalStateException');
  });

  it('links the attachments without naming a bucket or a URL to them', () => {
    const { report } = validate({ ...good(), attachments: [{ kind: 'logcat', bytes: 10 }] });
    const body = issueBody(report, 'r_abc', filed, base);
    expect(body).toContain('https://heyari.dev/reports/r_abc');
    expect(body).toContain(`deleted automatically after ${RETENTION_DAYS} days`);
    expect(body).not.toMatch(/s3|amazonaws/i);
  });

  it('says plainly when no files were sent', () => {
    const { report } = validate(good());
    expect(issueBody(report, 'r_abc', filed, base)).toContain('No diagnostic files');
  });

  it('a withdrawn report keeps nothing of what was written', () => {
    const body = redactedBody('r_abc', '2026-10-01T09:00:00Z', false);
    expect(body).toContain('Withdrawn');
    expect(body).toContain('permanently erased');
    expect(body).not.toContain('Home Assistant');
  });

  it('says why the thread survived when people had replied', () => {
    expect(redactedBody('r_abc', 'now', true)).toContain('left open because others have replied');
    expect(redactedBody('r_abc', 'now', false)).toContain('Nobody had replied');
  });
});

describe('identifiers and keys', () => {
  it('mints unlikely-to-collide report ids', () => {
    const ids = new Set(Array.from({ length: 500 }, newReportId));
    expect(ids.size).toBe(500);
    expect([...ids][0]).toMatch(/^r_[0-9a-f]{24}$/);
  });

  it('hashes the delete token rather than storing it', () => {
    const token = newDeleteToken();
    const hash = hashToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(token);
    expect(hashToken(token)).toBe(hash);
  });

  it('puts every attachment under the report prefix', () => {
    expect(objectKey('r_abc', 'logcat')).toBe('reports/r_abc/logcat.txt');
    expect(objectKey('r_abc', 'screenshot')).toBe('reports/r_abc/screenshot.png');
    expect(objectKey('r_abc', 'wake-audio')).toBe('reports/r_abc/wake-audio.zip');
  });

  it('expires records 90 days out, in whole seconds', () => {
    const now = new Date('2026-09-02T00:00:00Z');
    const ttl = expiresAt(now);
    expect(Number.isInteger(ttl)).toBe(true);
    expect(ttl - Math.floor(now.getTime() / 1000)).toBe(RETENTION_DAYS * 86400);
  });

  it('expires rate counters in days, not months — they are keyed by install id', () => {
    const now = new Date('2026-09-02T00:00:00Z');
    const seconds = rateExpiresAt(now) - Math.floor(now.getTime() / 1000);
    expect(seconds).toBe(2 * 86400);
    expect(rateExpiresAt(now)).toBeLessThan(expiresAt(now));
  });

  it('buckets rate counters by UTC day', () => {
    expect(rateDay(new Date('2026-09-02T23:59:59Z'))).toBe('2026-09-02');
    expect(rateDay(new Date('2026-09-03T00:00:01Z'))).toBe('2026-09-03');
  });
});

describe('routing', () => {
  it('recognises the three endpoints', () => {
    expect(route('/api/bug')).toEqual({ action: 'create' });
    expect(route('/api/bug/r_abc/finalise')).toEqual({ action: 'finalise', id: 'r_abc' });
    expect(route('/api/bug/r_abc/delete')).toEqual({ action: 'delete', id: 'r_abc' });
  });

  it('tolerates a trailing slash', () => {
    expect(route('/api/bug/')).toEqual({ action: 'create' });
  });

  it('refuses anything else, including the other function\'s path', () => {
    expect(route('/api/report')).toBeNull();
    expect(route('/api/bug/r_abc')).toBeNull();
    expect(route('/api/bug/r_abc/publish')).toBeNull();
    expect(route('/api/bug/a/b/c/d')).toBeNull();
    expect(route('/')).toBeNull();
  });
});

describe('origin secret', () => {
  it('passes when the header matches', () => {
    expect(originSecretOk({ 'x-origin-secret': 'shh' }, 'shh')).toBe(true);
  });

  it('fails on a wrong or missing header, whatever its length', () => {
    expect(originSecretOk({ 'x-origin-secret': 'nope' }, 'shh')).toBe(false);
    expect(originSecretOk({ 'x-origin-secret': 'shhhhhhhhhhhhh' }, 'shh')).toBe(false);
    expect(originSecretOk({}, 'shh')).toBe(false);
    expect(originSecretOk(undefined, 'shh')).toBe(false);
  });

  it('is skipped when unconfigured, so the function runs locally', () => {
    expect(originSecretOk({}, undefined)).toBe(true);
  });
});

describe('github app jwt', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = privateKey.export({ type: 'pkcs1', format: 'pem' });

  it('signs a verifiable RS256 token', () => {
    const jwt = appJwt({ appId: '4804123', privateKey: pem });
    const [header, payload, signature] = jwt.split('.');
    const verifier = createVerify('RSA-SHA256');
    verifier.update(`${header}.${payload}`);
    expect(verifier.verify(publicKey, Buffer.from(signature, 'base64url'))).toBe(true);
  });

  it('back-dates iat, because GitHub rejects a token from the future', () => {
    const now = 1_756_819_682_000;
    const jwt = appJwt({ appId: '4804123', privateKey: pem }, now);
    const claims = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());
    expect(claims.iat).toBe(Math.floor(now / 1000) - 60);
    expect(claims.iss).toBe('4804123');
    expect(claims.exp - claims.iat).toBeLessThanOrEqual(600);
  });
});

describe('body size cap', () => {
  it('is big enough for a real report and small enough to bound abuse', () => {
    const realistic = JSON.stringify({
      ...good(),
      stackTrace: 'at dev.heyari.ari.voice.VoiceSession.stop(VoiceSession.kt:187)\n'.repeat(60),
      skills: Array.from({ length: 20 }, (_, i) => ({ id: `dev.heyari.skill${i}`, version: '1.0.0' })),
    });
    expect(Buffer.byteLength(realistic)).toBeLessThan(MAX_BODY_BYTES);
    expect(MAX_BODY_BYTES).toBeLessThanOrEqual(128 * 1024);
  });
});

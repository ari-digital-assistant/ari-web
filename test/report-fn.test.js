import { describe, it, expect } from 'vitest';
import {
  validate,
  formatEmail,
  originSecretOk,
  CATEGORIES,
  KINDS,
  MAX_BODY_BYTES,
} from '../functions/report/index.mjs';

const good = { category: 'offensive', text: 'something Ari said' };

describe('report payload validation', () => {
  it('accepts the minimum a report needs', () => {
    const r = validate(good);
    expect(r.ok).toBe(true);
    expect(r.report.text).toBe('something Ari said');
    expect(r.report.category).toBe('offensive');
  });

  it('leaves every optional field null rather than undefined', () => {
    // formatEmail renders these with ?? — undefined would work, but null is
    // what the app omits and what the tests below assert against.
    const { report } = validate(good);
    expect(report.prompt).toBeNull();
    expect(report.note).toBeNull();
    expect(report.skillId).toBeNull();
    expect(report.appVersion).toBeNull();
  });

  it('keeps the optional fields when they are sent', () => {
    const { report } = validate({
      ...good,
      prompt: 'what the user asked',
      note: 'this was unpleasant',
      skillId: 'dev.heyari.assistant.claude',
      appVersion: '0.1.0',
    });
    expect(report.prompt).toBe('what the user asked');
    expect(report.note).toBe('this was unpleasant');
    expect(report.skillId).toBe('dev.heyari.assistant.claude');
    expect(report.appVersion).toBe('0.1.0');
  });

  it('requires text', () => {
    expect(validate({ category: 'offensive' })).toEqual({ ok: false, reason: 'text is required' });
    expect(validate({ ...good, text: '   ' })).toEqual({ ok: false, reason: 'text is required' });
    expect(validate({ ...good, text: 42 })).toEqual({ ok: false, reason: 'text is required' });
  });

  it('requires a known category', () => {
    expect(validate({ ...good, category: 'rude' }).ok).toBe(false);
    expect(validate({ text: 'x' }).ok).toBe(false);
    for (const category of CATEGORIES) {
      expect(validate({ ...good, category }).ok).toBe(true);
    }
  });

  it('rejects anything that is not a JSON object', () => {
    for (const raw of [null, 'a string', 42, ['an', 'array']]) {
      expect(validate(raw)).toEqual({ ok: false, reason: 'body must be a JSON object' });
    }
  });

  it('drops an over-long field instead of truncating it', () => {
    // Truncating would email a half-sentence that reads as the user's words.
    // The app caps the same fields, so over-length means a crafted request.
    expect(validate({ ...good, text: 'x'.repeat(4001) }).ok).toBe(false);
    expect(validate({ ...good, text: 'x'.repeat(4000) }).ok).toBe(true);
    expect(validate({ ...good, note: 'x'.repeat(1001) }).report.note).toBeNull();
    expect(validate({ ...good, skillId: 'x'.repeat(129) }).report.skillId).toBeNull();
  });

  it('never reflects the submitted content in a rejection reason', () => {
    const reason = validate({ ...good, category: '<script>alert(1)</script>' }).reason;
    expect(reason).toBe('unknown category');
  });
});

describe('report email', () => {
  const at = '2026-08-27T10:00:00.000Z';

  it('names the category and skill in the subject', () => {
    const { report } = validate({ ...good, skillId: 'dev.heyari.assistant.claude' });
    expect(formatEmail(report, at).subject)
      .toBe('[Ari report] offensive — dev.heyari.assistant.claude');
  });

  it('leaves the skill out of the subject when there is none', () => {
    expect(formatEmail(validate(good).report, at).subject).toBe('[Ari report] offensive');
  });

  it('says so explicitly when a field was not recorded', () => {
    // A blank would read as an empty value rather than an absent one.
    const body = formatEmail(validate(good).report, at).body;
    expect(body).toContain('Skill:       (not recorded)');
    expect(body).toContain('App version: (not recorded)');
    expect(body).toContain('Received:    2026-08-27T10:00:00.000Z');
  });

  it('includes the reported text', () => {
    expect(formatEmail(validate(good).report, at).body).toContain('something Ari said');
  });

  it('omits the prompt and note sections entirely when withheld', () => {
    const body = formatEmail(validate(good).report, at).body;
    expect(body).not.toContain('What the user had said');
    expect(body).not.toContain('User note');
  });

  it('includes the prompt and note when the user sent them', () => {
    const { report } = validate({ ...good, prompt: 'what the user asked', note: 'unpleasant' });
    const body = formatEmail(report, at).body;
    expect(body).toContain('What the user had said');
    expect(body).toContain('what the user asked');
    expect(body).toContain('User note');
    expect(body).toContain('unpleasant');
  });
});

describe('body size cap', () => {
  it('is small enough that a flood cannot be expensive', () => {
    expect(MAX_BODY_BYTES).toBe(16 * 1024);
  });
});

describe('origin secret', () => {
  const secret = 'a-long-random-value';

  it('accepts the header CloudFront sends', () => {
    expect(originSecretOk({ 'x-origin-secret': secret }, secret)).toBe(true);
  });

  it('rejects a wrong secret', () => {
    expect(originSecretOk({ 'x-origin-secret': 'nope' }, secret)).toBe(false);
  });

  it('rejects a request that carries no secret at all', () => {
    // What a caller hitting the API Gateway endpoint directly looks like.
    expect(originSecretOk({}, secret)).toBe(false);
    expect(originSecretOk(undefined, secret)).toBe(false);
  });

  it('rejects a non-string header', () => {
    // API Gateway gives strings, but a crafted event should not throw.
    expect(originSecretOk({ 'x-origin-secret': 42 }, secret)).toBe(false);
    expect(originSecretOk({ 'x-origin-secret': null }, secret)).toBe(false);
  });

  it('compares secrets of differing length without throwing', () => {
    // timingSafeEqual rejects mismatched lengths outright, hence the HMAC.
    expect(originSecretOk({ 'x-origin-secret': 'x' }, secret)).toBe(false);
    expect(originSecretOk({ 'x-origin-secret': 'x'.repeat(500) }, secret)).toBe(false);
  });

  it('is skipped entirely when no secret is configured', () => {
    // Lets the function run locally and under test without one.
    expect(originSecretOk({}, undefined)).toBe(true);
    expect(originSecretOk({}, '')).toBe(true);
  });
});

describe('report kind', () => {
  const at = '2026-08-27T10:00:00.000Z';

  it('defaults to a response report', () => {
    expect(validate(good).report.kind).toBe('response');
  });

  it('accepts a skill report', () => {
    expect(validate({ ...good, kind: 'skill' }).report.kind).toBe('skill');
  });

  it('rejects an unknown kind', () => {
    expect(validate({ ...good, kind: 'nonsense' })).toEqual({ ok: false, reason: 'unknown kind' });
  });

  it('offers exactly the two kinds', () => {
    expect(KINDS).toEqual(['response', 'skill']);
  });

  it('labels a skill report as a skill, not a quote', () => {
    // Calling a skill name "Reported response" would read as something Ari
    // said, which is the one thing it is not.
    const { report } = validate({ ...good, kind: 'skill', skillId: 'dev.heyari.timer' });
    const email = formatEmail(report, at);
    expect(email.subject).toBe('[Ari skill report] offensive — dev.heyari.timer');
    expect(email.body).toContain('Reported skill');
    expect(email.body).not.toContain('Reported response');
    expect(email.body).toContain('Kind:        skill');
  });

  it('leaves a response report reading as before', () => {
    const email = formatEmail(validate(good).report, at);
    expect(email.subject).toBe('[Ari report] offensive');
    expect(email.body).toContain('Reported response');
  });
});

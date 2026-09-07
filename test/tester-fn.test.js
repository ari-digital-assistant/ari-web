import { describe, it, expect, beforeAll } from 'vitest';
import {
  validate,
  formatEmail,
  looksLikeEmail,
  originSecretOk,
  challengeFor,
  checkChallenge,
  emailKey,
  route,
  CHALLENGE_TTL_MS,
  MAX_BODY_BYTES,
  MAX_NUMBER,
} from '../functions/tester/index.mjs';

/** The base64 JSON the browser posts back. */
const encode = (payload) => Buffer.from(JSON.stringify(payload)).toString('base64');

/**
 * Brute-forces the challenge with nothing but SubtleCrypto — deliberately the
 * same handful of lines the page runs in the browser, rather than altcha-lib's
 * own solver. The risk worth testing is that the two halves agree, and a
 * library verifying its own solver would not show that.
 *
 * Slow on purpose; that is the entire mechanism. Callers solve once and reuse.
 */
async function solved(challenge) {
  const encoder = new TextEncoder();
  for (let number = 0; number <= challenge.maxnumber; number++) {
    const digest = await crypto.subtle.digest('SHA-256', encoder.encode(challenge.salt + number));
    const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
    if (hex === challenge.challenge) return encode({ ...challenge, number });
  }
  throw new Error('the challenge had no solution below maxnumber');
}

const good = { email: 'someone@example.com', consent: true };

describe('signup validation', () => {
  it('accepts the minimum a signup needs', () => {
    expect(validate(good)).toEqual({
      status: 'ok',
      signup: { email: 'someone@example.com', name: null, note: null },
    });
  });

  it('keeps the optional fields when they are sent', () => {
    const { signup } = validate({ ...good, name: 'Someone', note: 'I have a Pixel 6a' });
    expect(signup.name).toBe('Someone');
    expect(signup.note).toBe('I have a Pixel 6a');
  });

  it('trims whitespace off every field it keeps', () => {
    const { signup } = validate({ ...good, email: '  someone@example.com  ', name: ' Someone ' });
    expect(signup.email).toBe('someone@example.com');
    expect(signup.name).toBe('Someone');
  });

  it('requires an email', () => {
    expect(validate({ consent: true }))
      .toEqual({ status: 'rejected', reason: 'a valid email is required' });
    expect(validate({ ...good, email: '   ' }).status).toBe('rejected');
    expect(validate({ ...good, email: 42 }).status).toBe('rejected');
  });

  it('requires the consent box to have been ticked', () => {
    // Consent is the lawful basis for holding the address at all, so an
    // absent, false or truthy-but-not-true value all mean "do not act on this".
    for (const consent of [undefined, false, null, 'yes', 1]) {
      expect(validate({ email: 'someone@example.com', consent }))
        .toEqual({ status: 'rejected', reason: 'consent is required' });
    }
  });

  it('rejects anything that is not a JSON object', () => {
    for (const raw of [null, 'a string', 42, ['an', 'array']]) {
      expect(validate(raw)).toEqual({ status: 'rejected', reason: 'body must be a JSON object' });
    }
  });

  it('drops an over-long optional field instead of truncating it', () => {
    expect(validate({ ...good, note: 'x'.repeat(1001) }).signup.note).toBeNull();
    expect(validate({ ...good, note: 'x'.repeat(1000) }).signup.note).toBe('x'.repeat(1000));
    expect(validate({ ...good, name: 'x'.repeat(81) }).signup.name).toBeNull();
  });

  it('refuses an address longer than RFC 5321 allows', () => {
    const long = `${'x'.repeat(250)}@example.com`;
    expect(validate({ ...good, email: long }).status).toBe('rejected');
  });

  it('never reflects the submitted content in a rejection reason', () => {
    expect(validate({ ...good, email: '<script>alert(1)</script>' }).reason)
      .toBe('a valid email is required');
  });
});

describe('honeypot', () => {
  it('drops a submission that filled the hidden field', () => {
    expect(validate({ ...good, website: 'http://spam.example' })).toEqual({ status: 'dropped' });
  });

  it('is not tripped by the empty value a real browser sends', () => {
    // The input is always present in the DOM, so every genuine submission
    // carries it as an empty string.
    expect(validate({ ...good, website: '' }).status).toBe('ok');
    expect(validate({ ...good, website: '   ' }).status).toBe('ok');
  });

  it('drops a honeypot value too long to be a real field', () => {
    // The field caps elsewhere refuse an over-long value rather than truncate
    // it, so the honeypot must not be read through one of them or padding it
    // would be a way past the trap.
    expect(validate({ ...good, website: 'x'.repeat(5000) })).toEqual({ status: 'dropped' });
  });

  it('is checked before anything else, so a bot learns nothing from the reply', () => {
    // A bot that fills every field AND sends rubbish must still see the same
    // answer as one that fills every field correctly.
    expect(validate({ website: 'spam', email: 'not-an-email', consent: false }))
      .toEqual({ status: 'dropped' });
  });
});

describe('email shape', () => {
  it('accepts ordinary addresses', () => {
    for (const address of [
      'a@b.co',
      'someone@example.com',
      'first.last+tag@sub.example.co.uk',
      "o'brien@example.ie",
    ]) {
      expect(looksLikeEmail(address)).toBe(true);
    }
  });

  it('rejects addresses that cannot work', () => {
    for (const address of [
      'no-at-sign',
      '@example.com',
      'two@at@example.com',
      'someone@nodot',
      'someone@.example.com',
      'someone@example.',
      'someone@exa..mple.com',
      '',
    ]) {
      expect(looksLikeEmail(address)).toBe(false);
    }
  });

  it('rejects anything carrying whitespace, which is what a header injection needs', () => {
    expect(looksLikeEmail('someone@example.com\nBcc: victim@example.com')).toBe(false);
    expect(looksLikeEmail('someone@example.com\r\nSubject: x')).toBe(false);
    expect(looksLikeEmail('some one@example.com')).toBe(false);
    expect(looksLikeEmail('someone@example.com\tx')).toBe(false);
  });

  it('rejects a non-string', () => {
    for (const value of [null, undefined, 42, {}, []]) {
      expect(looksLikeEmail(value)).toBe(false);
    }
  });
});

describe('notification email', () => {
  const at = '2026-09-07T10:00:00.000Z';

  it('puts the address in the subject so the inbox is searchable', () => {
    expect(formatEmail(validate(good).signup, at).subject)
      .toBe('[Ari tester] someone@example.com');
  });

  it('says so explicitly when a name was not given', () => {
    // A blank would read as an empty name rather than an absent one.
    const { body } = formatEmail(validate(good).signup, at);
    expect(body).toContain('Email:     someone@example.com');
    expect(body).toContain('Name:      (not given)');
    expect(body).toContain('Received:  2026-09-07T10:00:00.000Z');
  });

  it('records that consent was given, which is the reason we may hold the address', () => {
    expect(formatEmail(validate(good).signup, at).body)
      .toContain('Consent:   ticked on heyari.dev/tester');
  });

  it('omits the note section entirely when there is no note', () => {
    expect(formatEmail(validate(good).signup, at).body).not.toContain('What they said');
  });

  it('includes the note when one was written', () => {
    const { signup } = validate({ ...good, note: 'I have a Pixel 6a on GrapheneOS' });
    const { body } = formatEmail(signup, at);
    expect(body).toContain('What they said');
    expect(body).toContain('I have a Pixel 6a on GrapheneOS');
  });

  it('ends with the action the email exists to prompt', () => {
    expect(formatEmail(validate(good).signup, at).body)
      .toContain('Add them under Play Console > Testing > Internal testing > Testers.');
  });
});

describe('body size cap', () => {
  it('is small enough that a flood cannot be expensive', () => {
    expect(MAX_BODY_BYTES).toBe(8 * 1024);
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
    expect(originSecretOk({ 'x-origin-secret': 42 }, secret)).toBe(false);
    expect(originSecretOk({ 'x-origin-secret': null }, secret)).toBe(false);
  });

  it('compares secrets of differing length without throwing', () => {
    // timingSafeEqual rejects mismatched lengths outright, hence the HMAC.
    expect(originSecretOk({ 'x-origin-secret': 'x' }, secret)).toBe(false);
    expect(originSecretOk({ 'x-origin-secret': 'x'.repeat(500) }, secret)).toBe(false);
  });

  it('is skipped entirely when no secret is configured', () => {
    expect(originSecretOk({}, undefined)).toBe(true);
    expect(originSecretOk({}, '')).toBe(true);
  });
});

describe('routing', () => {
  it('tells the two endpoints apart', () => {
    expect(route('/api/tester')).toBe('apply');
    expect(route('/api/tester/')).toBe('apply');
    expect(route('/api/tester/challenge')).toBe('challenge');
    expect(route('/api/tester/challenge/')).toBe('challenge');
  });

  it('claims nothing that belongs to another function', () => {
    // /api/report and /api/bug/* are other Lambdas on the same HTTP API.
    for (const path of ['/api/report', '/api/bug', '/api/bug/x/finalise', '/api', '/', '']) {
      expect(route(path)).toBeNull();
    }
  });

  it('refuses a path that merely starts the same way', () => {
    expect(route('/api/testers')).toBeNull();
    expect(route('/api/tester/challenge/extra')).toBeNull();
    expect(route('/api/tester/anything')).toBeNull();
  });
});

describe('proof-of-work challenge', () => {
  const key = 'a-test-hmac-key';
  const address = 'someone@example.com';

  // Solving is the expensive half by design, so the fixtures are built once
  // and the tests below vary what is checked against them rather than
  // re-solving. Two challenges: one live, one already expired when it was
  // minted, because solving does not care about expiry but verifying must.
  let live;
  let stale;
  beforeAll(async () => {
    live = await solved(await challengeFor(emailKey(address), key));
    stale = await solved(await challengeFor(emailKey(address), key, Date.now() - CHALLENGE_TTL_MS - 1000));
  }, 60000);

  it('binds the challenge to the address it was minted for', async () => {
    const challenge = await challengeFor(emailKey(address), key);
    expect(challenge.salt).toContain(`eh=${emailKey(address)}`);
    expect(challenge.algorithm).toBe('SHA-256');
    expect(challenge.maxnumber).toBe(MAX_NUMBER);
    expect(challenge.signature).toMatch(/^[0-9a-f]{64}$/);
  });

  it('expires ten minutes out, not at some library default', async () => {
    const now = 1_757_000_000_000;
    const challenge = await challengeFor(emailKey(address), key, now);
    const expires = new URLSearchParams(challenge.salt.split('?')[1]).get('expires');
    expect(Number(expires)).toBe(Math.floor((now + CHALLENGE_TTL_MS) / 1000));
  });

  it('refuses to mint one without a real SHA-256 hex digest', async () => {
    for (const bad of [undefined, null, 42, '', 'nope', 'z'.repeat(64), emailKey(address).slice(0, 63)]) {
      expect(await challengeFor(bad, key)).toBeNull();
    }
  });

  it('accepts a genuine solution for the address it was minted for', async () => {
    expect(await checkChallenge(live, address, key)).toEqual({ ok: true });
  });

  it('accepts the same address typed with different capitals', async () => {
    // The binding is over the lower-cased address, so SOMEONE@Example.com is
    // the same mailbox and must not be turned away at the door.
    expect(await checkChallenge(live, 'SOMEONE@Example.com', key)).toEqual({ ok: true });
  });

  it('refuses a solution replayed against a different address', async () => {
    // The attack this exists to stop: solve once, then mail from a thousand
    // made-up addresses on the one solution.
    expect(await checkChallenge(live, 'someone-else@example.com', key))
      .toEqual({ ok: false, reason: 'the anti-spam check was not for this address' });
  });

  it('refuses an expired challenge however well it was solved', async () => {
    expect(await checkChallenge(stale, address, key))
      .toEqual({ ok: false, reason: 'the anti-spam check did not pass' });
  });

  it('refuses a solution signed with somebody else\'s key', async () => {
    expect(await checkChallenge(live, address, 'a-different-key'))
      .toEqual({ ok: false, reason: 'the anti-spam check did not pass' });
  });

  it('refuses a payload whose answer has been edited', async () => {
    const payload = JSON.parse(Buffer.from(live, 'base64').toString('utf8'));
    const tampered = encode({ ...payload, number: payload.number + 1 });
    expect(await checkChallenge(tampered, address, key))
      .toEqual({ ok: false, reason: 'the anti-spam check did not pass' });
  });

  it('refuses a payload whose binding has been edited', async () => {
    // Swapping the address out of the salt breaks the signature, because the
    // salt is what the signed challenge hash was computed over.
    const payload = JSON.parse(Buffer.from(live, 'base64').toString('utf8'));
    const tampered = encode({
      ...payload,
      salt: payload.salt.replace(emailKey(address), emailKey('someone-else@example.com')),
    });
    expect(await checkChallenge(tampered, address, key))
      .toEqual({ ok: false, reason: 'the anti-spam check did not pass' });
  });

  it('refuses a missing or unusable payload without throwing', async () => {
    for (const bad of [undefined, null, 42, {}, [], '', 'not-base64', Buffer.from('{}').toString('base64')]) {
      const result = await checkChallenge(bad, address, key);
      expect(result.ok).toBe(false);
    }
  });

  it('refuses an absurdly long payload before doing any crypto', async () => {
    expect(await checkChallenge('x'.repeat(4097), address, key))
      .toEqual({ ok: false, reason: 'the anti-spam check is missing' });
  });
});

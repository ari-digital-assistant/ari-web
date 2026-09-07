import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { createChallenge, extractParams, verifySolution } from 'altcha-lib/v1';

// Signups arrive from a public form on heyari.dev, so everything below assumes
// the body is hostile until proven otherwise. Nothing is stored: the address
// goes straight into one email to the maintainer and the request is over. Two
// things bound the blast radius — SES stays in sandbox, so the only address
// this can ever mail is the verified one in TESTER_TO, and the function's
// reserved concurrency caps what a burst can cost.
export const MAX_BODY_BYTES = 8 * 1024;

// The address cap is RFC 5321's; the other two are the form's own maxlengths.
const LIMITS = { name: 80, email: 254, note: 1000 };

// Long enough to fill the form in at a leisurely pace, short enough that a
// solved challenge is not worth hoarding.
export const CHALLENGE_TTL_MS = 10 * 60 * 1000;

// The browser tries numbers from zero until one hashes to the challenge, and
// the answer is uniform in this range — so the expected work is half of it,
// call it fifty thousand SHA-256 digests. Under a second on a laptop, two or
// three on a tired phone. The page starts solving when the email field loses
// focus, so it is normally finished before anyone reaches the submit button.
//
// Raising this is not the lever it looks like. Proof-of-work stops the bots
// that never run any JavaScript, which is most form spam, and makes bulk
// submission cost something; it will not stop somebody who actually wants to
// get through. What does the real work here is that a solved challenge is
// bound to one address (see challengeFor), so a spammer buys one email per
// solve rather than a pipe.
export const MAX_NUMBER = 100_000;

const str = (v, max) => (typeof v === 'string' && v.length <= max ? v.trim() : null);

const BLANKS = [' ', '\t', '\n', '\r'];

/**
 * A deliberately loose check: enough to catch a typo and to guarantee the
 * value is safe to put in a header, and no more. Trying to decide by pattern
 * which addresses really exist is a well-known way to reject somebody's
 * perfectly good mailbox, and the answer arrives anyway the moment they don't
 * reply to the invite.
 */
export function looksLikeEmail(value) {
  if (typeof value !== 'string') return false;
  if (BLANKS.some((c) => value.includes(c))) return false;
  const at = value.indexOf('@');
  if (at < 1 || at !== value.lastIndexOf('@')) return false;
  const domain = value.slice(at + 1);
  if (!domain.includes('.') || domain.startsWith('.') || domain.endsWith('.')) return false;
  return !domain.includes('..');
}

/**
 * The value a challenge is bound to. Lower-cased because the same mailbox
 * reached with different capitals is the same mailbox, and the page has to
 * derive this identically in the browser. What gets emailed is still the
 * address exactly as it was typed.
 */
export const emailKey = (email) =>
  createHash('sha256').update(email.trim().toLowerCase()).digest('hex');

const HEX = '0123456789abcdef';
const isSha256Hex = (v) =>
  typeof v === 'string' && v.length === 64 && [...v].every((c) => HEX.includes(c));

/**
 * A proof-of-work challenge bound to one email address.
 *
 * The binding is the whole point. `createChallenge` folds `params` into the
 * salt and signs the hash of salt-plus-answer, so anything in there is covered
 * by the HMAC and cannot be edited after the fact. A solution is therefore
 * worth exactly one address, for ten minutes — a bot that solves one cannot
 * turn it into a stream of applications from made-up addresses.
 */
export async function challengeFor(emailHashHex, hmacKey, now = Date.now()) {
  if (!isSha256Hex(emailHashHex)) return null;
  return createChallenge({
    hmacKey,
    maxnumber: MAX_NUMBER,
    expires: new Date(now + CHALLENGE_TTL_MS),
    params: { eh: emailHashHex },
  });
}

/**
 * `{ ok: true }`, or `{ ok: false, reason }` naming which half failed.
 *
 * Two separate questions: is this a real solution to a challenge we signed and
 * that has not expired, and was that challenge issued for the address now being
 * submitted. Passing the first and failing the second is what a replayed
 * solution looks like.
 */
export async function checkChallenge(payload, email, hmacKey) {
  if (typeof payload !== 'string' || payload.length > 4096) {
    return { ok: false, reason: 'the anti-spam check is missing' };
  }
  if (!(await verifySolution(payload, hmacKey, true))) {
    return { ok: false, reason: 'the anti-spam check did not pass' };
  }
  if (extractParams(payload).eh !== emailKey(email)) {
    return { ok: false, reason: 'the anti-spam check was not for this address' };
  }
  return { ok: true };
}

/**
 * Which endpoint this is. Both routes land on this one function, so the path
 * is what tells them apart.
 */
export function route(path) {
  const parts = path.replace(/\/+$/, '').split('/').filter(Boolean);
  if (parts[0] !== 'api' || parts[1] !== 'tester') return null;
  if (parts.length === 2) return 'apply';
  if (parts.length === 3 && parts[2] === 'challenge') return 'challenge';
  return null;
}

/**
 * One of:
 *   `{ status: 'ok', signup }`       — worth emailing.
 *   `{ status: 'rejected', reason }` — malformed. The reason names the field
 *                                      at fault and never quotes it, so the
 *                                      response cannot reflect attacker input.
 *   `{ status: 'dropped' }`          — the honeypot was filled in, so this came
 *                                      from a bot. The caller still answers as
 *                                      though it worked: telling a bot it was
 *                                      spotted only improves the next one.
 */
export function validate(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { status: 'rejected', reason: 'body must be a JSON object' };
  }

  // Named for what it pretends to be, not for what it is. The form renders it
  // off-screen with autocomplete off, so a person never sees it and a bot that
  // fills every field it finds gives itself away.
  if (typeof raw.website === 'string' && raw.website.trim() !== '') return { status: 'dropped' };

  const email = str(raw.email, LIMITS.email);
  if (!email || !looksLikeEmail(email)) return { status: 'rejected', reason: 'a valid email is required' };

  // The record that consent was given, which is the lawful basis for holding
  // the address at all. An unticked box is a signup we must not act on.
  if (raw.consent !== true) return { status: 'rejected', reason: 'consent is required' };

  return {
    status: 'ok',
    signup: {
      email,
      name: str(raw.name, LIMITS.name) || null,
      note: str(raw.note, LIMITS.note) || null,
    },
  };
}

export function formatEmail(signup, receivedAt) {
  const lines = [
    `Email:     ${signup.email}`,
    `Name:      ${signup.name ?? '(not given)'}`,
    'Consent:   ticked on heyari.dev/tester',
    `Received:  ${receivedAt}`,
  ];
  if (signup.note) {
    lines.push('', 'What they said', '--------------', signup.note);
  }
  lines.push('', 'Add them under Play Console > Testing > Internal testing > Testers.');
  return { subject: `[Ari tester] ${signup.email}`, body: lines.join('\n') };
}

/**
 * Whether the request came through CloudFront rather than straight at the API
 * Gateway endpoint, which is public.
 *
 * Identical in shape to the check in functions/report — the two functions sit
 * behind the same distribution and the same custom origin header. Not shared,
 * because sharing it would mean a fourth npm workspace to hold ten lines and a
 * build step that puts it in both zips.
 *
 * Compared through an HMAC so the comparison is constant-time even when the
 * two strings differ in length, which `timingSafeEqual` alone will not accept.
 */
export function originSecretOk(headers, expected) {
  if (!expected) return true;
  const got = headers?.['x-origin-secret'];
  if (typeof got !== 'string') return false;
  const mac = (v) => createHmac('sha256', expected).update(v).digest();
  return timingSafeEqual(mac(got), mac(expected));
}

const client = new SESv2Client({});

const reply = (statusCode, payload) => ({
  statusCode,
  headers: { 'content-type': 'application/json' },
  body: payload === undefined ? '' : JSON.stringify(payload),
});
const errorReply = (statusCode, reason) => reply(statusCode, { error: reason });

export const handler = async (event) => {
  // 401, deliberately not 403: the distribution rewrites 403 to its 404 page,
  // so a 403 here would reach the caller as website HTML and be undebuggable.
  // The same goes for 404, which is why an unknown path below answers 400.
  if (!originSecretOk(event?.headers, process.env.ORIGIN_SECRET)) {
    return errorReply(401, 'not from the front door');
  }
  if (event?.requestContext?.http?.method !== 'POST') return errorReply(405, 'POST only');

  const action = route(event.rawPath ?? event.requestContext?.http?.path ?? '');
  if (!action) return errorReply(400, 'unknown endpoint');

  const body = event.isBase64Encoded
    ? Buffer.from(event.body ?? '', 'base64').toString('utf8')
    : (event.body ?? '');
  if (Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES) return errorReply(413, 'body too large');

  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    return errorReply(400, 'body must be JSON');
  }

  if (action === 'challenge') {
    const challenge = await challengeFor(parsed?.emailHash, process.env.ALTCHA_SECRET);
    if (!challenge) return errorReply(400, 'emailHash must be a SHA-256 hex digest');
    return reply(200, challenge);
  }

  const result = validate(parsed);
  if (result.status === 'dropped') return reply(204);
  if (result.status === 'rejected') return errorReply(400, result.reason);

  // After validation, so a malformed body costs a string compare rather than
  // a round of HMAC work, and before SES, so an unsolved challenge never
  // reaches the inbox.
  const check = await checkChallenge(parsed.altcha, result.signup.email, process.env.ALTCHA_SECRET);
  if (!check.ok) return errorReply(400, check.reason);

  const { subject, body: text } = formatEmail(result.signup, new Date().toISOString());
  try {
    await client.send(new SendEmailCommand({
      FromEmailAddress: process.env.TESTER_FROM,
      Destination: { ToAddresses: [process.env.TESTER_TO] },
      // So replying to the notification replies to the person who applied.
      // Safe because looksLikeEmail has already refused anything containing
      // whitespace, which is what a header injection would need.
      ReplyToAddresses: [result.signup.email],
      Content: { Simple: { Subject: { Data: subject }, Body: { Text: { Data: text } } } },
    }));
  } catch (err) {
    // Say nothing useful to the caller, but leave a trace in CloudWatch — a
    // silent failure here means somebody volunteers and never hears back.
    console.error('SES send failed', err);
    return errorReply(502, 'could not deliver the application');
  }

  return reply(204);
};

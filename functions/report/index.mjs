import { createHmac, timingSafeEqual } from 'node:crypto';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';

// Reports arrive from the Android app through CloudFront, so everything below
// assumes the body is hostile until proven otherwise. The blast radius is
// deliberately small: SES stays in sandbox, which means the only address this
// can ever mail is the verified one in REPORT_TO, and the account's 200/day cap
// applies whatever the caller does.
export const MAX_BODY_BYTES = 16 * 1024;

export const CATEGORIES = ['offensive', 'harmful', 'wrong', 'other'];

// Per-field caps. The app's dialog shows the user the whole payload before it
// sends, so these are a backstop against a crafted request rather than a limit
// real users will meet.
const LIMITS = { text: 4000, prompt: 4000, note: 1000, skillId: 128, appVersion: 32 };

const str = (v, max) => (typeof v === 'string' && v.length <= max ? v.trim() : null);

/**
 * `{ ok: true, report }` or `{ ok: false, reason }`. A reason names the field
 * at fault and never quotes it — the response must not reflect attacker input.
 */
export function validate(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, reason: 'body must be a JSON object' };
  }
  const text = str(raw.text, LIMITS.text);
  if (!text) return { ok: false, reason: 'text is required' };
  if (!CATEGORIES.includes(raw.category)) return { ok: false, reason: 'unknown category' };

  return {
    ok: true,
    report: {
      category: raw.category,
      text,
      // Optional throughout: the dialog lets the user withhold the prompt, and
      // a report with only the offending turn is still worth having.
      prompt: str(raw.prompt, LIMITS.prompt) || null,
      note: str(raw.note, LIMITS.note) || null,
      skillId: str(raw.skillId, LIMITS.skillId) || null,
      appVersion: str(raw.appVersion, LIMITS.appVersion) || null,
    },
  };
}

export function formatEmail(report, receivedAt) {
  const subject = `[Ari report] ${report.category}${report.skillId ? ` — ${report.skillId}` : ''}`;
  const lines = [
    `Category:    ${report.category}`,
    `Skill:       ${report.skillId ?? '(not recorded)'}`,
    `App version: ${report.appVersion ?? '(not recorded)'}`,
    `Received:    ${receivedAt}`,
    '',
    'Reported response',
    '-----------------',
    report.text,
  ];
  if (report.prompt) {
    lines.push('', 'What the user had said', '----------------------', report.prompt);
  }
  if (report.note) {
    lines.push('', 'User note', '---------', report.note);
  }
  return { subject, body: lines.join('\n') };
}

/**
 * Whether the request came through CloudFront rather than straight at the API
 * Gateway endpoint, which is public.
 *
 * CloudFront adds `x-origin-secret` as an origin custom header; nothing else
 * knows it. This is what an Origin Access Control would have given us, except
 * OAC does not support API Gateway origins. An unset `expected` means the
 * check is not configured and is skipped, so the function still runs locally
 * and under test without one.
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

const reply = (statusCode, reason) => ({
  statusCode,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(reason ? { error: reason } : {}),
});

export const handler = async (event) => {
  // 401, deliberately not 403: the distribution rewrites 403 to its 404 page,
  // so a 403 here would reach the caller as website HTML and be undebuggable.
  if (!originSecretOk(event?.headers, process.env.ORIGIN_SECRET)) {
    return reply(401, 'not from the front door');
  }
  if (event?.requestContext?.http?.method !== 'POST') return reply(405, 'POST only');

  const body = event.isBase64Encoded
    ? Buffer.from(event.body ?? '', 'base64').toString('utf8')
    : (event.body ?? '');
  if (Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES) return reply(413, 'body too large');

  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    return reply(400, 'body must be JSON');
  }

  const result = validate(parsed);
  if (!result.ok) return reply(400, result.reason);

  const { subject, body: text } = formatEmail(result.report, new Date().toISOString());
  try {
    await client.send(new SendEmailCommand({
      FromEmailAddress: process.env.REPORT_FROM,
      Destination: { ToAddresses: [process.env.REPORT_TO] },
      Content: { Simple: { Subject: { Data: subject }, Body: { Text: { Data: text } } } },
    }));
  } catch (err) {
    // Say nothing useful to the caller, but leave a trace in CloudWatch — a
    // silent failure here means reports vanish and nobody finds out.
    console.error('SES send failed', err);
    return reply(502, 'could not deliver the report');
  }

  return reply(204);
};

// Validation, limits, keys and routing for /api/contrib. Everything here is
// pure — no AWS, no network — so the whole decision surface is testable
// without provisioning anything.

import { createHmac, timingSafeEqual } from 'node:crypto';

// Only metadata travels through the Lambda; the audio goes straight to S3 on a
// pre-signed URL. Sixty files of name-and-byte-count is a few kilobytes, so
// this bounds a crafted body rather than a real one.
export const MAX_BODY_BYTES = 32 * 1024;

// What a clip may be contributed as. The category decides the prefix it lands
// under, so an unknown one is rejected rather than stored somewhere nobody
// will think to look.
export const CATEGORIES = new Set(['wake', 'false-trigger', 'command']);

// The two halves of a clip. A sidecar without its audio is useless and audio
// without its sidecar is unlabelled, but the pairing is the app's business —
// this only decides how each is stored.
export const CONTENT_TYPES = {
  wav: 'audio/wav',
  txt: 'text/plain; charset=utf-8',
};

export const LIMITS = {
  // A capture clip is a few seconds of 16 kHz mono; a minute of it is under
  // 2 MB. Four leaves room for a long one and refuses anything that could not
  // have come from the capture stores.
  bytesPerFile: 4 * 1024 * 1024,
  filesPerBatch: 60,
  bytesPerBatch: 16 * 1024 * 1024,
  // A day of enthusiastic contributing, and no more. The byte cap is the
  // tighter bound in practice.
  filesPerContributorPerDay: 400,
  bytesPerContributorPerDay: 120 * 1024 * 1024,
  // Deleting lists and erases a whole prefix, which is the most expensive
  // thing here. Nobody needs to do it five times in a day.
  deletesPerContributorPerDay: 5,
};

const CONTRIBUTOR_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// Language tag as the app stores it: `en`, `it`, occasionally `en-GB`.
const LOCALE = /^[a-z]{2}(-[A-Za-z0-9]{2,8})?$/;
// A capture filename and nothing else. Anchored, no slashes, no leading dot —
// this string becomes the last segment of an S3 key, so anything that could
// climb out of the contributor's prefix has to fail here.
const FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.(wav|txt)$/;

const fail = (reason) => ({ ok: false, reason });

/**
 * `{ ok: true, batch }` or `{ ok: false, reason }`.
 *
 * A reason names the field at fault and never quotes it: the response must not
 * reflect caller input, because the caller is not necessarily the app.
 */
export function validate(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return fail('body must be a JSON object');
  }

  const contributorId = contributorIdOf(raw.contributorId);
  if (!contributorId) return fail('contributorId must be a UUID');

  const locale = typeof raw.locale === 'string' ? raw.locale.trim() : '';
  if (!LOCALE.test(locale)) return fail('locale is required');

  if (!Array.isArray(raw.files)) return fail('files must be an array');
  if (raw.files.length === 0) return fail('files is empty');
  if (raw.files.length > LIMITS.filesPerBatch) return fail('too many files in one batch');

  const files = [];
  const seen = new Set();
  let totalBytes = 0;
  for (const f of raw.files) {
    if (f === null || typeof f !== 'object') return fail('each file must be an object');
    if (!CATEGORIES.has(f.category)) return fail('unknown category');
    if (typeof f.name !== 'string' || !FILE_NAME.test(f.name) || f.name.includes('..')) {
      return fail('each file needs a plain capture filename');
    }
    if (seen.has(f.name)) return fail('duplicate filename');
    if (!Number.isInteger(f.bytes) || f.bytes <= 0) {
      return fail('each file needs a positive byte count');
    }
    if (f.bytes > LIMITS.bytesPerFile) return fail('a file exceeds the per-file size limit');

    seen.add(f.name);
    totalBytes += f.bytes;
    files.push({
      category: f.category,
      name: f.name,
      bytes: f.bytes,
      contentType: CONTENT_TYPES[f.name.split('.').pop()],
    });
  }
  if (totalBytes > LIMITS.bytesPerBatch) return fail('batch exceeds the size limit');

  return { ok: true, batch: { contributorId, locale, files, totalBytes } };
}

/**
 * The id as it will be used, or null.
 *
 * Case-folded rather than rejected on case: the recovery code is something a
 * person retypes on a new phone, and a capital letter is not a reason to lose
 * access to your own data.
 */
export function contributorIdOf(raw) {
  if (typeof raw !== 'string') return null;
  const id = raw.trim().toLowerCase();
  return CONTRIBUTOR_ID.test(id) ? id : null;
}

/**
 * Where one file lives.
 *
 * Language above category because a corpus is only useful within a language:
 * listing everything Italian is a prefix query, not a scan. The contributor id
 * is the top segment so that deleting somebody's data is one prefix and can
 * never reach anybody else's.
 */
export const objectKey = (contributorId, locale, category, name) =>
  `contrib/${contributorId}/${locale}/${category}/${name}`;

/** Everything one contributor has ever sent. The unit of deletion. */
export const prefixFor = (contributorId) => `contrib/${contributorId}/`;

/** The UTC day a rate-limit counter belongs to. */
export const rateDay = (now = new Date()) => now.toISOString().slice(0, 10);

/**
 * Rate counters are keyed by contributor id, so they have no business
 * outliving the day they bound. Two days rather than one because the buckets
 * are UTC days and DynamoDB's TTL sweep is best-effort.
 */
export function rateExpiresAt(now = new Date()) {
  return Math.floor(now.getTime() / 1000) + 2 * 24 * 60 * 60;
}

/**
 * Whether a batch fits inside today's budget, given the counters as they stood
 * BEFORE it was counted.
 */
export function withinLimits(counters, files, totalBytes) {
  const sent = counters?.files ?? 0;
  const bytes = counters?.bytes ?? 0;
  if (sent + files > LIMITS.filesPerContributorPerDay) {
    return fail('daily contribution limit reached');
  }
  if (bytes + totalBytes > LIMITS.bytesPerContributorPerDay) {
    return fail('daily upload limit reached');
  }
  return { ok: true };
}

export function withinDeleteLimit(counters) {
  const deletes = counters?.deletes ?? 0;
  if (deletes >= LIMITS.deletesPerContributorPerDay) {
    return fail('daily deletion limit reached');
  }
  return { ok: true };
}

export function route(path) {
  const parts = path.replace(/\/+$/, '').split('/').filter(Boolean);
  if (parts[0] !== 'api' || parts[1] !== 'contrib') return null;
  if (parts.length === 2) return { action: 'mint', method: 'POST' };
  if (parts.length === 3 && parts[2] === 'delete') return { action: 'delete', method: 'POST' };
  return null;
}

/**
 * Whether the request came through CloudFront rather than straight at the API
 * Gateway endpoint, which is public.
 *
 * Same mechanism as /api/bug: CloudFront adds `x-origin-secret` as an origin
 * custom header and nothing else knows it. An unset `expected` means the check
 * is not configured and everything passes, which is what lets the function be
 * deployed before the distribution knows about it.
 */
export function originSecretOk(headers, expected) {
  if (!expected) return true;
  const got = headers?.['x-origin-secret'];
  if (typeof got !== 'string') return false;
  const mac = (v) => createHmac('sha256', expected).update(v).digest();
  return timingSafeEqual(mac(got), mac(expected));
}

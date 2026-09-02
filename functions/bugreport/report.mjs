// Validation, limits and issue rendering for /api/bug. Everything here is
// pure — no AWS, no network — so the whole decision surface is testable
// without provisioning anything.

import { randomBytes, createHash, createHmac, timingSafeEqual } from 'node:crypto';

// Bigger than the content-report function's 16 KB because a stack trace and a
// skill list ride along, but still small enough that a crafted body cannot be
// used to run up Lambda time. Attachments never travel through here — they go
// straight to S3 on a pre-signed URL — so this bounds metadata only.
export const MAX_BODY_BYTES = 64 * 1024;

// What the app may ask to upload. The kind decides the object key and the
// content type, so an unknown kind is rejected rather than stored under a name
// nobody will recognise six weeks later.
export const ATTACHMENT_KINDS = {
  logcat: { ext: 'txt', contentType: 'text/plain' },
  screenshot: { ext: 'png', contentType: 'image/png' },
  conversation: { ext: 'json', contentType: 'application/json' },
  commands: { ext: 'zip', contentType: 'application/zip' },
  'wake-audio': { ext: 'zip', contentType: 'application/zip' },
  'all-audio': { ext: 'zip', contentType: 'application/zip' },
};

export const LIMITS = {
  description: 4000,
  privateNote: 4000,
  stackTrace: 20000,
  attachmentsPerReport: 8,
  bytesPerReport: 20 * 1024 * 1024,
  reportsPerInstallPerDay: 5,
  bytesPerInstallPerDay: 60 * 1024 * 1024,
  skills: 64,
  permissions: 32,
};

// Personal data is deleted at 90 days. The GitHub issue is not: it is the
// project's bug history rather than the reporter's data.
export const RETENTION_DAYS = 90;

const str = (v, max) => (typeof v === 'string' && v.length <= max ? v.trim() : null);
const num = (v) => (Number.isInteger(v) && v >= 0 ? v : null);
const bool = (v) => (typeof v === 'boolean' ? v : null);

const fail = (reason) => ({ ok: false, reason });

/**
 * `{ ok: true, report }` or `{ ok: false, reason }`.
 *
 * A reason names the field at fault and never quotes it. The response must not
 * reflect caller input, because the caller is not necessarily the app.
 */
export function validate(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return fail('body must be a JSON object');
  }

  const installId = str(raw.installId, 64);
  if (!installId) return fail('installId is required');

  // The one field that is definitely going to be published. Everything else in
  // the public block is machine-generated; this is the only place a person
  // types into that ends up on a public issue, which is why the app labels it
  // as public and offers privateNote for anything else.
  const description = str(raw.description, LIMITS.description);
  if (!description) return fail('description is required');

  const app = raw.app;
  if (app === null || typeof app !== 'object') return fail('app is required');
  const version = str(app.version, 32);
  if (!version) return fail('app.version is required');

  const device = raw.device;
  if (device === null || typeof device !== 'object') return fail('device is required');
  const model = str(device.model, 64);
  const androidVersion = str(device.androidVersion, 16);
  if (!model || !androidVersion) return fail('device.model and device.androidVersion are required');

  const attachments = [];
  const rawAttachments = raw.attachments ?? [];
  if (!Array.isArray(rawAttachments)) return fail('attachments must be an array');
  if (rawAttachments.length > LIMITS.attachmentsPerReport) return fail('too many attachments');

  let totalBytes = 0;
  const seen = new Set();
  for (const a of rawAttachments) {
    if (a === null || typeof a !== 'object') return fail('each attachment must be an object');
    if (!Object.hasOwn(ATTACHMENT_KINDS, a.kind)) return fail('unknown attachment kind');
    if (seen.has(a.kind)) return fail('duplicate attachment kind');
    const bytes = num(a.bytes);
    if (bytes === null || bytes === 0) return fail('each attachment needs a positive byte count');
    seen.add(a.kind);
    totalBytes += bytes;
    attachments.push({ kind: a.kind, bytes });
  }
  if (totalBytes > LIMITS.bytesPerReport) return fail('attachments exceed the per-report size limit');

  const skills = [];
  const rawSkills = raw.skills ?? [];
  if (!Array.isArray(rawSkills)) return fail('skills must be an array');
  for (const s of rawSkills.slice(0, LIMITS.skills)) {
    const id = str(s?.id, 128);
    if (id) skills.push({ id, version: str(s?.version, 32) });
  }

  const permissions = (Array.isArray(raw.device.permissions) ? raw.device.permissions : [])
    .slice(0, LIMITS.permissions)
    .map((p) => str(p, 64))
    .filter(Boolean);

  return {
    ok: true,
    report: {
      installId,
      description,
      // Never published. Written to the private prefix beside the attachments
      // so a reporter has somewhere to put a hostname or an address.
      privateNote: str(raw.privateNote, LIMITS.privateNote) || null,
      stackTrace: str(raw.stackTrace, LIMITS.stackTrace) || null,
      app: {
        version,
        buildType: str(app.buildType, 16) || 'unknown',
        commit: str(app.commit, 40) || null,
        engineVersion: str(app.engineVersion, 32) || null,
        locale: str(app.locale, 16) || null,
      },
      setup: {
        assistant: str(raw.setup?.assistant, 32) || null,
        model: str(raw.setup?.model, 64) || null,
        stt: str(raw.setup?.stt, 64) || null,
        tts: str(raw.setup?.tts, 64) || null,
        wake: str(raw.setup?.wake, 64) || null,
      },
      device: {
        model,
        androidVersion,
        fingerprint: str(device.fingerprint, 200) || null,
        ramFreeMb: num(device.ramFreeMb),
        storageFreeMb: num(device.storageFreeMb),
        network: str(device.network, 16) || null,
        batteryExempt: bool(device.batteryExempt),
        permissions,
      },
      skills,
      attachments,
      totalBytes,
    },
  };
}

/**
 * Whether this install may file another report of this size today.
 *
 * Checked when the pre-signed URLs are issued, not when the issue is created.
 * The bucket is the expensive thing to abuse, so the limit has to bite before
 * anyone is handed somewhere to write.
 */
export function withinLimits(counters, totalBytes) {
  const reports = counters?.reports ?? 0;
  const bytes = counters?.bytes ?? 0;
  if (reports >= LIMITS.reportsPerInstallPerDay) {
    return fail('daily report limit reached for this install');
  }
  if (bytes + totalBytes > LIMITS.bytesPerInstallPerDay) {
    return fail('daily upload limit reached for this install');
  }
  return { ok: true };
}

export function newReportId() {
  return `r_${randomBytes(12).toString('hex')}`;
}

export function newDeleteToken() {
  return randomBytes(32).toString('base64url');
}

export const hashToken = (token) => createHash('sha256').update(token).digest('hex');

export const objectKey = (reportId, kind) =>
  `reports/${reportId}/${kind}.${ATTACHMENT_KINDS[kind].ext}`;

/** The UTC day a rate-limit counter belongs to. */
export const rateDay = (now = new Date()) => now.toISOString().slice(0, 10);

export function expiresAt(now = new Date()) {
  return Math.floor(now.getTime() / 1000) + RETENTION_DAYS * 24 * 60 * 60;
}

/**
 * Rate counters are keyed by install id, so they are mildly personal and have
 * no business living as long as a report does. Two days rather than one
 * because the buckets are UTC days and DynamoDB's TTL sweep is best-effort.
 */
export function rateExpiresAt(now = new Date()) {
  return Math.floor(now.getTime() / 1000) + 2 * 24 * 60 * 60;
}

export function issueTitle(report) {
  const firstLine = report.description.split('\n')[0].trim();
  if (!firstLine) return 'Bug report from the Ari app';
  return firstLine.length <= 80 ? firstLine : `${firstLine.slice(0, 77)}...`;
}

const yesNo = (v) => (v === null ? 'unknown' : v ? 'yes' : 'no');
const orDash = (v) => v ?? '—';

/**
 * The public issue body.
 *
 * Everything here is either machine-generated or the description the reporter
 * was told would be published. The stack trace is included on purpose: class
 * names and line numbers carry no personal data and are the single most useful
 * thing another contributor can act on. Attachments are linked, never inlined.
 */
export function issueBody(report, reportId, filedAt, reportsBaseUrl) {
  const { app, setup, device } = report;
  const skills = report.skills.length
    ? report.skills.map((s) => `${s.id} ${s.version ?? '?'}`).join(', ')
    : 'none installed';

  const lines = [
    '### What happened',
    report.description,
    '',
    '### Build',
    `Ari ${app.version} (${app.buildType}${app.commit ? `, ${app.commit}` : ''})` +
      `${app.engineVersion ? ` · engine ${app.engineVersion}` : ''}` +
      `${app.locale ? ` · locale ${app.locale}` : ''}`,
    '',
    '### Setup',
    `Assistant: ${orDash(setup.assistant)}${setup.model ? ` (${setup.model})` : ''}`,
    `STT: ${orDash(setup.stt)} · TTS: ${orDash(setup.tts)} · Wake: ${orDash(setup.wake)}`,
    `Skills: ${skills}`,
    '',
    '### Device',
    `${device.model} · Android ${device.androidVersion}`,
    device.fingerprint,
    `RAM free ${orDash(device.ramFreeMb)} MB · storage free ${orDash(device.storageFreeMb)} MB` +
      `${device.network ? ` · ${device.network}` : ''}`,
    `Battery optimisation exempt: ${yesNo(device.batteryExempt)}`,
    `Permissions: ${device.permissions.length ? device.permissions.join(', ') : 'none granted'}`,
  ].filter((l) => l !== null);

  if (report.stackTrace) {
    lines.push('', '### Stack trace', '```', report.stackTrace, '```');
  }

  const kinds = report.attachments.map((a) => a.kind);
  lines.push(
    '',
    '---',
    `Report \`${reportId}\` · filed by the in-app reporter on ${filedAt}`,
  );
  if (kinds.length || report.privateNote) {
    lines.push(
      `Diagnostic files (${kinds.length ? kinds.join(', ') : 'private note only'}) are held ` +
        `privately and visible to maintainers at ${reportsBaseUrl}/${reportId}. ` +
        `They are deleted automatically after ${RETENTION_DAYS} days.`,
    );
  } else {
    lines.push('No diagnostic files were sent with this report.');
  }

  return lines.join('\n');
}

/**
 * What a withdrawn report's issue body becomes.
 *
 * Always a redaction, never a deletion: GitHub will not let an App delete an
 * issue at all — that needs repository admin, which is a preposterous thing to
 * grant something whose only job is filing bug reports. So the reporter's
 * words go and the shell of the issue stays, closed if nobody engaged with it
 * and open if they did.
 */
export function redactedBody(reportId, deletedAt, hadReplies) {
  return [
    '### Withdrawn',
    '',
    'The person who filed this report deleted it from the Ari app, and the',
    'diagnostic files that came with it have been permanently erased.',
    '',
    hadReplies
      ? 'The thread is left open because others have replied to it.'
      : 'Nobody had replied, so it is closed.',
    '',
    '---',
    `Report \`${reportId}\` · withdrawn ${deletedAt}`,
  ].join('\n');
}

/**
 * `/api/bug`, `/api/bug/<id>/finalise`, `/api/bug/<id>/delete`, or null.
 *
 * Lives here rather than beside the handler so the tests can exercise routing
 * without loading the AWS SDK.
 */
export function route(path) {
  const parts = path.replace(/\/+$/, '').split('/').filter(Boolean);
  if (parts[0] !== 'api' || parts[1] !== 'bug') return null;
  if (parts.length === 2) return { action: 'create' };
  if (parts.length === 4 && (parts[3] === 'finalise' || parts[3] === 'delete')) {
    return { action: parts[3], id: parts[2] };
  }
  return null;
}

/**
 * Whether the request came through CloudFront rather than straight at the API
 * Gateway endpoint, which is public.
 *
 * CloudFront adds `x-origin-secret` as an origin custom header; nothing else
 * knows it. An unset `expected` means the check is not configured and is
 * skipped, so the function still runs locally and under test without one.
 *
 * Compared through an HMAC so the comparison is constant-time even when the
 * two strings differ in length, which `timingSafeEqual` alone will not accept.
 *
 * Deliberately duplicated from the /api/report function rather than shared:
 * each Lambda is zipped from its own directory, so a shared module would have
 * to become a published package. Six lines is cheaper than that.
 */
export function originSecretOk(headers, expected) {
  if (!expected) return true;
  const got = headers?.['x-origin-secret'];
  if (typeof got !== 'string') return false;
  const mac = (v) => createHmac('sha256', expected).update(v).digest();
  return timingSafeEqual(mac(got), mac(expected));
}

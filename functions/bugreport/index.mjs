import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
} from '@aws-sdk/lib-dynamodb';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

import {
  MAX_BODY_BYTES,
  ATTACHMENT_KINDS,
  validate,
  withinLimits,
  newReportId,
  newDeleteToken,
  hashToken,
  objectKey,
  rateDay,
  expiresAt,
  rateExpiresAt,
  issueTitle,
  issueBody,
  redactedBody,
  route,
  originSecretOk,
} from './report.mjs';
import {
  installationToken,
  createIssue,
  updateIssue,
  issueComments,
} from './github.mjs';

const REGION = process.env.AWS_REGION;
const BUCKET = process.env.BUCKET;
const TABLE = process.env.TABLE;
const SECRET_ID = process.env.SECRET_ID;
const REPO = process.env.REPO;
const REPORTS_BASE_URL = process.env.REPORTS_BASE_URL ?? 'https://heyari.dev/reports';

const s3 = new S3Client({ region: REGION });
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));
const secrets = new SecretsManagerClient({ region: REGION });

// A pre-signed PUT is only good for as long as an upload needs. Fifteen minutes
// covers a few megabytes of audio on a bad connection and nothing else.
const UPLOAD_URL_TTL = 15 * 60;

// 401 rather than 403 for the same reason the report function does it: the
// distribution rewrites 403 to its own 404 page, so a 403 reaches the caller
// as website HTML and is undebuggable.
const reply = (statusCode, payload) => ({
  statusCode,
  headers: { 'content-type': 'application/json' },
  body: payload === undefined ? '' : JSON.stringify(payload),
});
const errorReply = (statusCode, reason) => reply(statusCode, { error: reason });

let credentials;
async function githubCredentials() {
  if (credentials) return credentials;
  const res = await secrets.send(new GetSecretValueCommand({ SecretId: SECRET_ID }));
  const parsed = JSON.parse(res.SecretString);
  credentials = {
    appId: parsed.app_id,
    installationId: parsed.installation_id,
    privateKey: parsed.private_key,
  };
  return credentials;
}

const reportKey = (id) => ({ pk: `report#${id}` });
const rateKey = (installId, day) => ({ pk: `rate#${installId}#${day}` });

/**
 * ConsistentRead is not optional here. A DynamoDB read is eventually
 * consistent by default, and both callers read a record that may have been
 * written seconds earlier — finalise right after create, delete right after
 * finalise. A stale read made delete find no issueNumber, skip the GitHub work
 * and still answer 204, so a reporter was told their report was withdrawn
 * while the issue sat there untouched.
 */
async function loadReport(id) {
  const res = await ddb.send(
    new GetCommand({ TableName: TABLE, Key: reportKey(id), ConsistentRead: true }),
  );
  return res.Item ?? null;
}

/**
 * Bumps this install's counters for today and returns them as they were
 * BEFORE the bump, so the caller can reject a request that has just pushed
 * itself over the line.
 *
 * An atomic ADD rather than read-then-write: two reports uploaded at once from
 * the same install would otherwise both read the old count and both be
 * allowed. This is the reason there is a DynamoDB table at all.
 */
async function bumpCounters(installId, bytes) {
  const res = await ddb.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: rateKey(installId, rateDay()),
      UpdateExpression: 'ADD reports :one, bytes :b SET expires = if_not_exists(expires, :ttl)',
      ExpressionAttributeValues: { ':one': 1, ':b': bytes, ':ttl': rateExpiresAt() },
      ReturnValues: 'UPDATED_OLD',
    }),
  );
  return { reports: res.Attributes?.reports ?? 0, bytes: res.Attributes?.bytes ?? 0 };
}

async function refundCounters(installId, bytes) {
  await ddb.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: rateKey(installId, rateDay()),
      UpdateExpression: 'ADD reports :minusOne, bytes :minusB',
      ExpressionAttributeValues: { ':minusOne': -1, ':minusB': -bytes },
    }),
  );
}

async function createReport(body) {
  const result = validate(body);
  if (!result.ok) return errorReply(400, result.reason);
  const report = result.report;

  const ttl = expiresAt();
  // Counted before anything is signed. A refund follows if the limit was
  // already blown, which costs one extra write on a path nobody normal hits.
  const before = await bumpCounters(report.installId, report.totalBytes);
  const allowed = withinLimits(before, report.totalBytes);
  if (!allowed.ok) {
    await refundCounters(report.installId, report.totalBytes);
    return errorReply(429, allowed.reason);
  }

  const id = newReportId();
  const deleteTokenValue = newDeleteToken();

  if (report.privateNote) {
    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: `reports/${id}/private-note.txt`,
        Body: report.privateNote,
        ContentType: 'text/plain; charset=utf-8',
      }),
    );
  }

  const uploads = await Promise.all(
    report.attachments.map(async (a) => ({
      kind: a.kind,
      contentType: ATTACHMENT_KINDS[a.kind].contentType,
      // ContentLength is signed into the URL, so the upload has to be exactly
      // the size the app declared and had counted against its daily budget.
      url: await getSignedUrl(
        s3,
        new PutObjectCommand({
          Bucket: BUCKET,
          Key: objectKey(id, a.kind),
          ContentType: ATTACHMENT_KINDS[a.kind].contentType,
          ContentLength: a.bytes,
        }),
        { expiresIn: UPLOAD_URL_TTL },
      ),
    })),
  );

  await ddb.send(
    new PutCommand({
      TableName: TABLE,
      Item: {
        ...reportKey(id),
        id,
        state: 'pending',
        installId: report.installId,
        createdAt: new Date().toISOString(),
        expires: ttl,
        deleteTokenHash: hashToken(deleteTokenValue),
        // The whole validated report, kept so finalise can render the issue
        // without the app having to send it twice.
        report,
      },
    }),
  );

  return reply(201, {
    reportId: id,
    deleteToken: deleteTokenValue,
    uploads,
    uploadUrlExpiresIn: UPLOAD_URL_TTL,
    deletedAfterDays: 90,
  });
}

async function finaliseReport(id) {
  const item = await loadReport(id);
  if (!item) return errorReply(404, 'no such report');
  if (item.state === 'filed') {
    return reply(200, { issueNumber: item.issueNumber, issueUrl: item.issueUrl });
  }

  // Every promised object has to actually be there. Filing an issue that links
  // to attachments which never uploaded is worse than filing nothing: it reads
  // as evidence that exists.
  for (const a of item.report.attachments) {
    const key = objectKey(id, a.kind);
    try {
      await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    } catch {
      return errorReply(409, 'an attachment was never uploaded');
    }
  }

  const creds = await githubCredentials();
  const token = await installationToken(creds);
  const filedAt = new Date().toISOString();
  const issue = await createIssue(token, REPO, {
    title: issueTitle(item.report),
    body: issueBody(item.report, id, filedAt, REPORTS_BASE_URL),
    labels: ['bug', 'from-app', `${item.report.app.buildType}-build`],
  });

  await ddb.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: reportKey(id),
      UpdateExpression: 'SET #s = :filed, issueNumber = :n, issueUrl = :u, filedAt = :f',
      ExpressionAttributeNames: { '#s': 'state' },
      ExpressionAttributeValues: {
        ':filed': 'filed',
        ':n': issue.number,
        ':u': issue.html_url,
        ':f': filedAt,
      },
    }),
  );

  return reply(201, { issueNumber: issue.number, issueUrl: issue.html_url });
}

async function deleteReport(id, token) {
  const item = await loadReport(id);
  // The same answer whether the report is gone or the token is wrong. A
  // caller guessing ids learns nothing from the difference.
  if (!item || !token || hashToken(token) !== item.deleteTokenHash) {
    return errorReply(404, 'no such report');
  }

  const listed = await s3.send(
    new ListObjectsV2Command({ Bucket: BUCKET, Prefix: `reports/${id}/` }),
  );
  const objects = (listed.Contents ?? []).map((o) => ({ Key: o.Key }));
  if (objects.length) {
    await s3.send(
      new DeleteObjectsCommand({ Bucket: BUCKET, Delete: { Objects: objects } }),
    );
  }

  if (item.issueNumber) {
    const creds = await githubCredentials();
    const ghToken = await installationToken(creds);
    // Redacted either way — an App cannot delete an issue, that needs repo
    // admin. Closed when nobody engaged; left open when they did, because
    // other people's replies are not the reporter's to bury.
    const comments = await issueComments(ghToken, REPO, item.issueNumber);
    const hadReplies = comments.length > 0;
    await updateIssue(ghToken, REPO, item.issueNumber, {
      title: 'Withdrawn bug report',
      body: redactedBody(id, new Date().toISOString(), hadReplies),
      state: hadReplies ? 'open' : 'closed',
    });
  }

  await ddb.send(new DeleteCommand({ TableName: TABLE, Key: reportKey(id) }));
  return reply(204);
}

export const handler = async (event) => {
  if (!originSecretOk(event?.headers, process.env.ORIGIN_SECRET)) {
    return errorReply(401, 'not from the front door');
  }
  if (event?.requestContext?.http?.method !== 'POST') return errorReply(405, 'POST only');

  const target = route(event.requestContext.http.path ?? '');
  if (!target) return errorReply(404, 'no such endpoint');

  const raw = event.isBase64Encoded
    ? Buffer.from(event.body ?? '', 'base64').toString('utf8')
    : (event.body ?? '');
  if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) return errorReply(413, 'body too large');

  let body = {};
  if (raw) {
    try {
      body = JSON.parse(raw);
    } catch {
      return errorReply(400, 'body must be JSON');
    }
  }

  try {
    if (target.action === 'create') return await createReport(body);
    if (target.action === 'finalise') return await finaliseReport(target.id);
    return await deleteReport(target.id, body?.deleteToken);
  } catch (err) {
    // Nothing useful to the caller, but a trace in CloudWatch — a silent
    // failure here means reports vanish and nobody finds out.
    console.error(`bug report ${target.action} failed`, err);
    return errorReply(502, 'could not process the report');
  }
};

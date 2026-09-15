import {
  S3Client,
  PutObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';

import {
  MAX_BODY_BYTES,
  contributorIdOf,
  objectKey,
  originSecretOk,
  prefixFor,
  rateDay,
  rateExpiresAt,
  route,
  validate,
  withinDeleteLimit,
  withinLimits,
} from './contrib.mjs';

const REGION = process.env.AWS_REGION;
const BUCKET = process.env.BUCKET;
const TABLE = process.env.TABLE;

// A pre-signed PUT is only good for as long as an upload needs. Fifteen
// minutes covers a batch of audio on a bad connection and nothing else.
const UPLOAD_URL_TTL = 15 * 60;

// S3 deletes a thousand keys per call. A contributor with a year of clips has
// more than that, so the delete path pages.
const DELETE_BATCH = 1000;

const s3 = new S3Client({ region: REGION });
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

// 401 rather than 403, for the same reason /api/bug does it: the distribution
// rewrites 403 to its own 404 page, so a 403 reaches the caller as website
// HTML and is undebuggable.
const reply = (statusCode, payload) => ({
  statusCode,
  headers: { 'content-type': 'application/json' },
  body: payload === undefined ? '' : JSON.stringify(payload),
});
const errorReply = (statusCode, reason) => reply(statusCode, { error: reason });

const rateKey = (contributorId, day) => ({ pk: `contrib-rate#${contributorId}#${day}` });

/**
 * Bumps this contributor's counters for today and returns them as they were
 * BEFORE the bump, so the caller can reject a batch that has just pushed
 * itself over the line.
 *
 * An atomic ADD rather than read-then-write: two phones sharing a recovered
 * contributor code would otherwise both read the old count and both be
 * allowed. This is the reason there is a DynamoDB table at all.
 */
async function bumpCounters(contributorId, attrs) {
  const names = Object.keys(attrs);
  const res = await ddb.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: rateKey(contributorId, rateDay()),
      UpdateExpression:
        `ADD ${names.map((n) => `${n} :${n}`).join(', ')} SET expires = if_not_exists(expires, :ttl)`,
      ExpressionAttributeValues: {
        ...Object.fromEntries(names.map((n) => [`:${n}`, attrs[n]])),
        ':ttl': rateExpiresAt(),
      },
      ReturnValues: 'UPDATED_OLD',
    }),
  );
  return res.Attributes ?? {};
}

async function mintUploads(body) {
  const result = validate(body);
  if (!result.ok) return errorReply(400, result.reason);
  const { contributorId, locale, files, totalBytes } = result.batch;

  // Counted before anything is signed. A refund follows if the budget was
  // already spent, which costs one extra write on a path nobody normal hits.
  const before = await bumpCounters(contributorId, { files: files.length, bytes: totalBytes });
  const allowed = withinLimits(before, files.length, totalBytes);
  if (!allowed.ok) {
    await bumpCounters(contributorId, { files: -files.length, bytes: -totalBytes });
    return errorReply(429, allowed.reason);
  }

  const uploads = await Promise.all(
    files.map(async (f) => ({
      name: f.name,
      contentType: f.contentType,
      // ContentLength is signed into the URL, so the upload has to be exactly
      // the size the app declared and had counted against its daily budget.
      url: await getSignedUrl(
        s3,
        new PutObjectCommand({
          Bucket: BUCKET,
          Key: objectKey(contributorId, locale, f.category, f.name),
          ContentType: f.contentType,
          ContentLength: f.bytes,
        }),
        { expiresIn: UPLOAD_URL_TTL },
      ),
    })),
  );

  return reply(201, { uploads, uploadUrlExpiresIn: UPLOAD_URL_TTL });
}

/**
 * Erases everything under one contributor's prefix.
 *
 * The id is the only credential, which is the whole design: somebody who has
 * lost the phone can still delete their recordings, and nobody can reach a
 * prefix they cannot name. A prefix is bounded by [prefixFor], so a request
 * cannot be made to delete more than its own contributor's data.
 */
async function deleteEverything(body) {
  const contributorId = contributorIdOf(body?.contributorId);
  if (!contributorId) return errorReply(400, 'contributorId must be a UUID');

  const before = await bumpCounters(contributorId, { deletes: 1 });
  const allowed = withinDeleteLimit(before);
  if (!allowed.ok) {
    await bumpCounters(contributorId, { deletes: -1 });
    return errorReply(429, allowed.reason);
  }

  const Prefix = prefixFor(contributorId);
  let deleted = 0;
  // No continuation token: each page is deleted before the next is listed, so
  // "the first thousand keys under the prefix" is always the right next page,
  // and an empty listing is the only way out. S3 list-after-delete is strongly
  // consistent, so this terminates.
  for (;;) {
    const listed = await s3.send(
      new ListObjectsV2Command({ Bucket: BUCKET, Prefix, MaxKeys: DELETE_BATCH }),
    );
    const keys = (listed.Contents ?? []).map((o) => ({ Key: o.Key }));
    if (keys.length === 0) break;
    await s3.send(
      new DeleteObjectsCommand({ Bucket: BUCKET, Delete: { Objects: keys, Quiet: true } }),
    );
    deleted += keys.length;
  }

  return reply(200, { deleted });
}

export const handler = async (event) => {
  if (!originSecretOk(event?.headers, process.env.ORIGIN_SECRET)) {
    return errorReply(401, 'not from the front door');
  }

  const target = route(event?.requestContext?.http?.path ?? '');
  if (!target) return errorReply(404, 'no such endpoint');
  if (event.requestContext.http.method !== target.method) {
    return errorReply(405, `${target.method} only`);
  }

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
    if (target.action === 'mint') return await mintUploads(body);
    return await deleteEverything(body);
  } catch (err) {
    // Nothing useful to the caller, but a trace in CloudWatch — a silent
    // failure here means a deletion somebody asked for never happened.
    console.error(`contribution ${target.action} failed`, err);
    return errorReply(502, 'could not process the request');
  }
};

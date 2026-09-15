import { describe, it, expect } from 'vitest';
import {
  validate,
  contributorIdOf,
  objectKey,
  prefixFor,
  rateDay,
  rateExpiresAt,
  route,
  withinLimits,
  withinDeleteLimit,
  originSecretOk,
  CATEGORIES,
  CONTENT_TYPES,
  LIMITS,
  MAX_BODY_BYTES,
} from '../functions/contrib/contrib.mjs';

const ID = '8b1d4e70-9c2a-4f31-8e55-0d6a7b9c1e23';

const good = (files = [{ category: 'wake', name: 'wake-000-accepted.wav', bytes: 1024 }]) => ({
  contributorId: ID,
  locale: 'en',
  files,
});

describe('payload validation', () => {
  it('accepts the minimum a batch needs', () => {
    const r = validate(good());
    expect(r.ok).toBe(true);
    expect(r.batch.contributorId).toBe(ID);
    expect(r.batch.locale).toBe('en');
    expect(r.batch.totalBytes).toBe(1024);
    expect(r.batch.files).toEqual([
      {
        category: 'wake',
        name: 'wake-000-accepted.wav',
        bytes: 1024,
        contentType: 'audio/wav',
      },
    ]);
  });

  it('gives a sidecar its own content type', () => {
    const r = validate(good([{ category: 'command', name: 'utterance-1-answered.txt', bytes: 40 }]));
    expect(r.batch.files[0].contentType).toBe('text/plain; charset=utf-8');
  });

  it('rejects a body that is not an object', () => {
    expect(validate(null).reason).toBe('body must be a JSON object');
    expect(validate([]).reason).toBe('body must be a JSON object');
    expect(validate('nope').reason).toBe('body must be a JSON object');
  });

  it('demands a UUID contributor id', () => {
    expect(validate({ ...good(), contributorId: 'keith' }).reason).toBe('contributorId must be a UUID');
    expect(validate({ ...good(), contributorId: undefined }).reason).toBe('contributorId must be a UUID');
  });

  it('demands a language tag', () => {
    expect(validate({ ...good(), locale: '' }).reason).toBe('locale is required');
    expect(validate({ ...good(), locale: 'english' }).reason).toBe('locale is required');
    expect(validate({ ...good(), locale: 'en-GB' }).ok).toBe(true);
  });

  it('refuses a filename that could climb out of the prefix', () => {
    for (const name of [
      '../../../etc/passwd.wav',
      'a/b.wav',
      '..wav',
      '.hidden.wav',
      'clip.mp3',
      'clip',
    ]) {
      const r = validate(good([{ category: 'wake', name, bytes: 10 }]));
      expect(r.ok, name).toBe(false);
      expect(r.reason, name).toBe('each file needs a plain capture filename');
    }
  });

  it('refuses an unknown category', () => {
    expect(validate(good([{ category: 'everything', name: 'x.wav', bytes: 1 }])).reason)
      .toBe('unknown category');
  });

  it('refuses a duplicate filename', () => {
    const r = validate(good([
      { category: 'wake', name: 'wake-1.wav', bytes: 10 },
      { category: 'command', name: 'wake-1.wav', bytes: 10 },
    ]));
    expect(r.reason).toBe('duplicate filename');
  });

  it('demands a positive byte count within the per-file cap', () => {
    expect(validate(good([{ category: 'wake', name: 'a.wav', bytes: 0 }])).reason)
      .toBe('each file needs a positive byte count');
    expect(validate(good([{ category: 'wake', name: 'a.wav', bytes: -1 }])).reason)
      .toBe('each file needs a positive byte count');
    expect(validate(good([{ category: 'wake', name: 'a.wav', bytes: 1.5 }])).reason)
      .toBe('each file needs a positive byte count');
    expect(validate(good([
      { category: 'wake', name: 'a.wav', bytes: LIMITS.bytesPerFile + 1 },
    ])).reason).toBe('a file exceeds the per-file size limit');
  });

  it('refuses an empty or oversized batch', () => {
    expect(validate({ ...good(), files: [] }).reason).toBe('files is empty');
    expect(validate({ ...good(), files: 'lots' }).reason).toBe('files must be an array');

    const many = Array.from({ length: LIMITS.filesPerBatch + 1 }, (_, i) => ({
      category: 'wake',
      name: `wake-${i}.wav`,
      bytes: 10,
    }));
    expect(validate({ ...good(), files: many }).reason).toBe('too many files in one batch');
  });

  it('refuses a batch whose files add up past the batch cap', () => {
    const chunk = LIMITS.bytesPerFile;
    const count = Math.ceil(LIMITS.bytesPerBatch / chunk) + 1;
    const files = Array.from({ length: count }, (_, i) => ({
      category: 'wake',
      name: `wake-${i}.wav`,
      bytes: chunk,
    }));
    expect(validate({ ...good(), files }).reason).toBe('batch exceeds the size limit');
  });
});

describe('contributor id', () => {
  it('folds case so a retyped recovery code still works', () => {
    expect(contributorIdOf(ID.toUpperCase())).toBe(ID);
    expect(contributorIdOf(`  ${ID}  `)).toBe(ID);
  });

  it('rejects anything that is not a UUID', () => {
    expect(contributorIdOf('')).toBeNull();
    expect(contributorIdOf('../other')).toBeNull();
    expect(contributorIdOf(ID.replace(/-/g, ''))).toBeNull();
    expect(contributorIdOf(42)).toBeNull();
  });
});

describe('object keys', () => {
  it('files a clip under contributor, language and category', () => {
    expect(objectKey(ID, 'it', 'false-trigger', 'wake-7-silent.wav'))
      .toBe(`contrib/${ID}/it/false-trigger/wake-7-silent.wav`);
  });

  it('bounds a deletion to one contributor', () => {
    expect(prefixFor(ID)).toBe(`contrib/${ID}/`);
  });
});

describe('limits', () => {
  it('allows a batch that fits inside today', () => {
    expect(withinLimits({ files: 10, bytes: 1000 }, 4, 500).ok).toBe(true);
    expect(withinLimits(undefined, 4, 500).ok).toBe(true);
  });

  it('refuses a batch that would cross the file count', () => {
    const r = withinLimits({ files: LIMITS.filesPerContributorPerDay, bytes: 0 }, 1, 1);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('daily contribution limit reached');
  });

  it('refuses a batch that would cross the byte budget', () => {
    const r = withinLimits({ files: 0, bytes: LIMITS.bytesPerContributorPerDay }, 1, 1);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('daily upload limit reached');
  });

  it('caps deletions per day', () => {
    expect(withinDeleteLimit({ deletes: 0 }).ok).toBe(true);
    expect(withinDeleteLimit(undefined).ok).toBe(true);
    const r = withinDeleteLimit({ deletes: LIMITS.deletesPerContributorPerDay });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('daily deletion limit reached');
  });
});

describe('rate counter keys', () => {
  it('buckets by UTC day', () => {
    expect(rateDay(new Date('2026-09-15T23:59:59Z'))).toBe('2026-09-15');
    expect(rateDay(new Date('2026-09-16T00:00:01Z'))).toBe('2026-09-16');
  });

  it('expires counters two days out', () => {
    const now = new Date('2026-09-15T12:00:00Z');
    expect(rateExpiresAt(now)).toBe(Math.floor(now.getTime() / 1000) + 2 * 86400);
  });
});

describe('routing', () => {
  it('maps the two endpoints', () => {
    expect(route('/api/contrib')).toEqual({ action: 'mint', method: 'POST' });
    expect(route('/api/contrib/')).toEqual({ action: 'mint', method: 'POST' });
    expect(route('/api/contrib/delete')).toEqual({ action: 'delete', method: 'POST' });
  });

  it('claims nothing that belongs to another function', () => {
    expect(route('/api/bug')).toBeNull();
    expect(route('/api/report')).toBeNull();
    expect(route('/api/contrib/delete/everything')).toBeNull();
    expect(route('/contrib')).toBeNull();
    expect(route('')).toBeNull();
  });
});

describe('origin secret', () => {
  it('passes everything when the check is not configured', () => {
    expect(originSecretOk({}, undefined)).toBe(true);
    expect(originSecretOk({}, '')).toBe(true);
  });

  it('accepts only the exact header CloudFront sends', () => {
    expect(originSecretOk({ 'x-origin-secret': 's3cret' }, 's3cret')).toBe(true);
    expect(originSecretOk({ 'x-origin-secret': 'wrong' }, 's3cret')).toBe(false);
    expect(originSecretOk({}, 's3cret')).toBe(false);
  });
});

describe('constants the app depends on', () => {
  it('names exactly the three contributable categories', () => {
    expect([...CATEGORIES].sort()).toEqual(['command', 'false-trigger', 'wake']);
  });

  it('stores audio as wav and sidecars as utf-8 text', () => {
    expect(CONTENT_TYPES).toEqual({ wav: 'audio/wav', txt: 'text/plain; charset=utf-8' });
  });

  it('bounds the metadata body well below a megabyte', () => {
    expect(MAX_BODY_BYTES).toBe(32 * 1024);
  });
});

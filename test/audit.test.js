import { describe, it, expect } from 'vitest';
import { triage } from '../scripts/audit.mjs';

const advisory = (id, range, severity = 'high') => ({
  source: 1,
  title: 'something bad',
  url: `https://github.com/advisories/${id}`,
  severity,
  range,
});

const report = (vulnerabilities) => ({ vulnerabilities });
const accepted = [{ id: 'GHSA-aaaa-bbbb-cccc', range: '<=4.0.7' }];

describe('audit gate triage', () => {
  it('waives an accepted advisory and blocks nothing else', () => {
    const r = report({
      picomatch: { via: [advisory('GHSA-aaaa-bbbb-cccc', '<=4.0.7')] },
      astro: { via: ['picomatch'] },
    });
    const { blocking, waived } = triage(r, accepted);
    expect(blocking).toEqual([]);
    expect(waived.map((a) => a.id)).toEqual(['GHSA-aaaa-bbbb-cccc']);
  });

  it('blocks the accepted advisory again once its range changes', () => {
    const r = report({ picomatch: { via: [advisory('GHSA-aaaa-bbbb-cccc', '<4.0.8')] } });
    expect(triage(r, accepted).blocking.map((a) => a.id)).toEqual(['GHSA-aaaa-bbbb-cccc']);
  });

  it('blocks any other high or critical advisory', () => {
    const r = report({
      picomatch: { via: [advisory('GHSA-aaaa-bbbb-cccc', '<=4.0.7')] },
      undici: { via: [advisory('GHSA-dddd-eeee-ffff', '<7.0.0', 'critical')] },
    });
    expect(triage(r, accepted).blocking.map((a) => a.pkg)).toEqual(['undici']);
  });

  it('lets moderate and low advisories through, as --audit-level=high did', () => {
    const r = report({ yaml: { via: [advisory('GHSA-gggg-hhhh-iiii', '<2.0.0', 'moderate')] } });
    expect(triage(r, accepted)).toEqual({ blocking: [], waived: [] });
  });

  it('throws on a report with no vulnerabilities section', () => {
    expect(() => triage({ error: { code: 'ENOTFOUND' } }, accepted)).toThrow(/no report/);
  });
});

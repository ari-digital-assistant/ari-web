// The deploy gate's dependency audit: `npm audit --omit=dev`, failing on any
// high or critical advisory, as the bare command did, except the few listed in
// ACCEPTED below.
//
// Each exception names the advisory's vulnerable range as well as its id. When
// upstream ships a fix, GitHub narrows that range, the exception stops matching
// and the gate fails again, which is the cue to update the lockfile and delete
// the entry. So an exception can't quietly outlive its reason.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ACCEPTED = [
  // picomatch ReDoS on crafted extglob patterns. Every release up to 4.0.7 is
  // affected and none is fixed yet (2026-11-18). Only Astro's and Vite's
  // build-time globbing uses it, on patterns from our own config, so nothing a
  // visitor sends ever reaches it.
  { id: 'GHSA-fc5q-39xc-vjpf', range: '<=4.0.7' },
];

const BLOCKING = new Set(['high', 'critical']);

const ghsa = (url) => url?.match(/GHSA-[\w-]+$/)?.[0];

/**
 * Splits a report from `npm audit --json` into the high and critical
 * advisories that fail the gate and the ones accepted above. Throws when the
 * report has no vulnerabilities section, as when the registry was unreachable,
 * so a broken audit fails the gate rather than passing it.
 */
export function triage(report, accepted = ACCEPTED) {
  if (!report?.vulnerabilities) {
    throw new Error(`npm audit gave no report: ${JSON.stringify(report?.error ?? report)}`);
  }
  const blocking = [];
  const waived = [];
  const seen = new Set();
  for (const [pkg, entry] of Object.entries(report.vulnerabilities)) {
    // `via` holds advisory objects for the package's own advisories and plain
    // names for vulnerable dependencies, which are reported under their own key.
    for (const via of entry.via) {
      if (typeof via !== 'object' || !BLOCKING.has(via.severity)) continue;
      const advisory = { pkg, id: ghsa(via.url) ?? String(via.source), range: via.range, title: via.title };
      const key = `${advisory.id} ${advisory.range}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const ok = accepted.some((a) => a.id === advisory.id && a.range === advisory.range);
      (ok ? waived : blocking).push(advisory);
    }
  }
  return { blocking, waived };
}

function runAudit() {
  try {
    return execFileSync('npm', ['audit', '--omit=dev', '--json'], { encoding: 'utf8', maxBuffer: 64 << 20 });
  } catch (err) {
    // npm audit exits non-zero whenever it finds anything; the JSON is still on stdout.
    if (err.stdout) return err.stdout;
    throw err;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { blocking, waived } = triage(JSON.parse(runAudit()));
  const line = (a) => `  ${a.pkg} ${a.range}: ${a.id} ${a.title ?? ''}`.trimEnd();
  if (waived.length) console.log(`accepted for now:\n${waived.map(line).join('\n')}`);
  if (blocking.length) {
    console.error(`high or critical advisories:\n${blocking.map(line).join('\n')}`);
    process.exit(1);
  }
  console.log('audit: no blocking advisories');
}

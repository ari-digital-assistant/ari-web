import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeAll } from 'vitest';
import { execSync } from 'node:child_process';

let html;
beforeAll(() => {
  execSync('npm run build --workspace site', { cwd: new URL('../../', import.meta.url) });
  html = readFileSync(new URL('../dist/privacy/index.html', import.meta.url), 'utf8');
}, 120000);

describe('/privacy page', () => {
  it('leads with the private-by-default thesis', () => {
    expect(html).toContain("Here's the deal with your data");
  });
  it('explains what runs on the device', () => {
    expect(html).toMatch(/wake word/i);
    expect(html).toMatch(/on the phone|on your device/i);
  });
  it('HONESTLY states what leaves the device and that it is opt-in', () => {
    // Guard against overclaiming "always on-device":
    expect(html).toMatch(/ChatGPT|Claude|Gemini|cloud assistant/i);
    expect(html).toMatch(/opt-in|optional|only because you asked|your call|uses-network/i);
  });
  it('states no account and no telemetry as fact', () => {
    expect(html).toMatch(/no analytics|no telemetry/i);
    expect(html).toMatch(/nothing to sign up for|no account|no login/i);
  });
  it('points to the open-source repos and the Friendly Manifesto', () => {
    expect(html).toContain('https://github.com/ari-digital-assistant');
    expect(html).toContain('https://friendlymanifesto.org');
  });
});

describe('/privacy on bug reports', () => {
  it('says a report only goes when the reporter sends it', () => {
    expect(html).toMatch(/does nothing until you press it/i);
    expect(html).toMatch(/no automatic crash upload/i);
  });

  it('keeps the public issue and the private files visibly apart', () => {
    // The whole design rests on this split. A future edit that blurs it here
    // would be describing a product we did not build.
    expect(html).toMatch(/public half/i);
    expect(html).toMatch(/private half/i);
    expect(html).toMatch(/never any audio/i);
  });

  it('says the log is scrubbed before it leaves and shown scrubbed', () => {
    expect(html).toMatch(/scrubbed on your phone/i);
    expect(html).toMatch(/best-effort/i);
  });

  it('REFUSES to imply end-to-end encryption', () => {
    // In transit and at rest, and we can read the files. Saying otherwise
    // would be the single most tempting overclaim on this page.
    expect(html).toMatch(/not end-to-end/i);
    expect(html).toMatch(/maintainers can open those files/i);
  });

  it('states both deletions, and that withdrawing does not erase the issue', () => {
    expect(html).toMatch(/90 days|90-day/i);
    expect(html).toMatch(/blanked, not deleted/i);
    expect(html).toMatch(/edit history/i);
  });

  it('warns that the delete key lives only on the phone', () => {
    expect(html).toMatch(/uninstall Ari/i);
  });

  it('keeps the #bug-reports anchor other repos link to', () => {
    // ari-android's README points people here. Astro does not slugify
    // headings in .astro, so this id is hand-written and easy to lose.
    expect(html).toMatch(/<h2[^>]*id="bug-reports"/);
  });

  it('names consent as the lawful basis and AWS as the processor', () => {
    expect(html).toMatch(/lawful basis/i);
    expect(html).toMatch(/consent/i);
    expect(html).toMatch(/AWS processes/i);
  });
});

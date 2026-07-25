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

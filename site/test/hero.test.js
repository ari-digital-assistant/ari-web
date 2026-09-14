import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeAll } from 'vitest';
import { execSync } from 'node:child_process';

let html;
beforeAll(() => {
  execSync('npm run build --workspace site', { cwd: new URL('../../', import.meta.url) });
  html = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');
}, 120000);

describe('home hero', () => {
  it('states the privacy thesis headline', () => {
    expect(html).toContain('never');
    expect(html).toContain('phones home');
  });
  it('leads with the tester CTA, which is what the project needs right now', () => {
    expect(html).toMatch(/class="btn btn-primary"[^>]*href="\/tester"/);
    expect(html).toContain('Become a tester');
  });
  it('keeps an honest pre-release GitHub CTA (no fake store links)', () => {
    expect(html).toContain('Star on GitHub');
    expect(html).not.toMatch(/play\.google\.com|f-droid\.org\/[a-z]/i);
  });
  it('shows the three trust markers', () => {
    for (const t of ['Runs offline', 'No telemetry', 'open-source']) expect(html).toContain(t);
  });
  it('puts the demo recording in the hero, with both encodes and a poster', () => {
    expect(html).toContain('<video');
    expect(html).toContain('/video/ari-demo.webm');
    expect(html).toContain('/video/ari-demo.mp4');
    expect(html).toContain('poster="/video/ari-demo-poster.jpg"');
    // WebM first: whoever can decode it takes the smaller file.
    expect(html.indexOf('ari-demo.webm')).toBeLessThan(html.indexOf('ari-demo.mp4'));
  });
  it('leaves the recording muted, looping, inline and unfetched until asked', () => {
    // Autoplay is only permitted while muted, looping is the whole point, and
    // playsinline stops iOS hijacking it into fullscreen. preload="none" keeps
    // the several-megabyte file off the critical path.
    const tag = html.match(/<video[^>]*>/)[0];
    expect(tag).toContain('muted');
    expect(tag).toContain('loop');
    expect(tag).toContain('playsinline');
    expect(tag).toContain('preload="none"');
  });
  it('carries the recording exactly once, and no longer ships a demo section', () => {
    // The standalone demo section was retired into the hero. A second <video>
    // would mean it grew back somewhere.
    expect(html.match(/<video/g)).toHaveLength(1);
    expect(html).not.toContain('id="demo"');
  });
});

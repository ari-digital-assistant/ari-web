import { describe, it, expect } from 'vitest';
import { isNet, niceName, metaDescription, screenshotPaths, REGISTRY_BASE, idFromPath, findSkill, filterSkills, cardHtml, detailHtml, galleryHtml, screenshotPlatforms, screenshotUrls, preferredPlatform, platformFromUserAgent } from '../src/lib/skills.js';

const weather = { id:'dev.heyari.weather', name:'weather', type:'skill', version:'0.1.0', description:'Current weather and forecasts.', capabilities:['http','location','storage_kv'], languages:['en','it'], author:'Ari core team', homepage:'https://github.com/ari-digital-assistant/ari-skills', license:'MIT' };
const coin = { id:'dev.heyari.coinflip', name:'coin-flip', type:'skill', version:'0.1.0', description:'Flips a coin.', capabilities:[], languages:['en','it'], author:'Ari core team', homepage:'', license:'MIT' };
const claude = { id:'dev.heyari.assistant.claude', name:'claude', type:'assistant', version:'0.3.0', description:'Use Claude.', capabilities:[], languages:['en','it'], author:'Ari Project', homepage:'', license:'MIT' };

describe('isNet', () => {
  it('assistants use the network', () => expect(isNet(claude)).toBe(true));
  it('http skills use the network', () => expect(isNet(weather)).toBe(true));
  it('no-capability skills are on-device', () => expect(isNet(coin)).toBe(false));
});
describe('niceName', () => {
  it('title-cases and de-hyphenates', () => expect(niceName('coin-flip')).toBe('Coin Flip'));
});
describe('idFromPath', () => {
  it('extracts the id', () => expect(idFromPath('/skills/dev.heyari.weather')).toBe('dev.heyari.weather'));
  it('handles a trailing slash', () => expect(idFromPath('/skills/dev.heyari.weather/')).toBe('dev.heyari.weather'));
  it('returns empty for the bare index', () => expect(idFromPath('/skills/')).toBe(''));
});
describe('findSkill', () => {
  it('finds by full id', () => expect(findSkill([weather,coin], 'dev.heyari.coinflip')).toBe(coin));
  it('returns undefined for unknown', () => expect(findSkill([weather], 'nope')).toBeUndefined());
});
describe('filterSkills', () => {
  const all = [weather, coin, claude];
  it('type=assistant keeps only assistants', () => expect(filterSkills(all, {type:'assistant', query:''})).toEqual([claude]));
  it('type=local drops networked skills', () => expect(filterSkills(all, {type:'local', query:''})).toEqual([coin]));
  it('query matches description', () => expect(filterSkills(all, {type:'all', query:'forecast'})).toEqual([weather]));
  it('query matches id', () => expect(filterSkills(all, {type:'all', query:'coinflip'})).toEqual([coin]));
});
describe('cardHtml', () => {
  it('links to the skill detail by full id and shows the on-device dot for local skills', () => {
    const h = cardHtml(coin);
    expect(h).toContain('href="/skills/dev.heyari.coinflip"');
    expect(h).toContain('on-device');
    expect(h).toContain('Coin Flip');
  });
  it('shows uses-network for http skills and its capability chips', () => {
    const h = cardHtml(weather);
    expect(h).toContain('uses network');
    expect(h).toContain('http');
    expect(h).toContain('location');
  });
});
describe('detailHtml', () => {
  it('renders facts, the honest banner, and a Get-Ari CTA (no fake store links)', () => {
    const h = detailHtml(weather);
    expect(h).toContain('Current weather');           // About
    expect(h).toContain('MIT');                        // license fact
    expect(h).toContain('0.1.0');                      // version fact
    expect(h).toMatch(/uses the network/i);             // honest banner (networked)
    expect(h).toContain('href="/#get"');               // Get Ari CTA
    expect(h).not.toMatch(/play\.google\.com|f-droid\.org\/[a-z]|apps\.apple\.com/i);
  });
  it('shows the on-device banner for local skills', () => {
    expect(detailHtml(coin)).toMatch(/runs entirely on your device/i);
  });
  it('does not render a javascript: homepage as a link (unsigned registry field)', () => {
    const evil = { ...weather, homepage: 'javascript:alert(1)' };
    const h = detailHtml(evil);
    expect(h).not.toContain('href="javascript:');
    expect(h).toContain('<span class="v">—</span>');
  });
  it('still renders the GitHub link for a normal https homepage', () => {
    const h = detailHtml(weather);
    expect(h).toContain('<a href="https://github.com/ari-digital-assistant/ari-skills">GitHub ↗</a>');
  });
});

const REG = 'https://raw.githubusercontent.com/ari-digital-assistant/ari-skills/main/';
const shot = (p, f) => `screenshots/dev.heyari.timer-0.2.0/${p}/${f}`;
const timer = { ...coin, id:'dev.heyari.timer', name:'timer', description:'Sets timers.', screenshots: {
  android: [shot('android','01-set.webp'), shot('android','02-list.webp')],
  linux: [shot('linux','01-set.png')],
} };

describe('screenshotPlatforms', () => {
  it('lists the platforms a skill has shots for', () => expect(screenshotPlatforms(timer)).toEqual(['android','linux']));
  it('is empty for a skill with none', () => expect(screenshotPlatforms(coin)).toEqual([]));
  it('ignores a platform whose list is empty', () => {
    expect(screenshotPlatforms({ screenshots: { android: [], linux: [shot('linux','a.png')] } })).toEqual(['linux']);
  });
});
describe('screenshotUrls', () => {
  it('resolves registry-relative paths in order, against the mirror by default', () => {
    expect(screenshotUrls(timer, 'android')).toEqual([
      '/registry/screenshots/dev.heyari.timer-0.2.0/android/01-set.webp',
      '/registry/screenshots/dev.heyari.timer-0.2.0/android/02-list.webp',
    ]);
  });
  it('resolves against the live registry when asked — the fallback template does', () => {
    expect(screenshotUrls(timer, 'linux', REGISTRY_BASE))
      .toEqual([`${REG}screenshots/dev.heyari.timer-0.2.0/linux/01-set.png`]);
  });
  it('is empty for a platform with no shots', () => expect(screenshotUrls(timer, 'windows')).toEqual([]));
});
describe('screenshotPaths', () => {
  it('collects every path across skills and platforms, sorted and deduped', () => {
    expect(screenshotPaths([timer, { ...timer, id: 'other' }, coin])).toEqual([
      'screenshots/dev.heyari.timer-0.2.0/android/01-set.webp',
      'screenshots/dev.heyari.timer-0.2.0/android/02-list.webp',
      'screenshots/dev.heyari.timer-0.2.0/linux/01-set.png',
    ]);
  });
  it('is empty for skills with no screenshots at all', () => {
    expect(screenshotPaths([coin])).toEqual([]);
    expect(screenshotPaths([])).toEqual([]);
    expect(screenshotPaths(null)).toEqual([]);
  });
  it('strips a leading slash so paths append cleanly to either base', () => {
    expect(screenshotPaths([{ screenshots: { android: ['/screenshots/a/b/1.webp'] } }]))
      .toEqual(['screenshots/a/b/1.webp']);
  });
});
describe('platformFromUserAgent', () => {
  it('reads Android before Linux', () => {
    expect(platformFromUserAgent('Mozilla/5.0 (Linux; Android 15; Pixel 9)')).toBe('android');
  });
  it('reads desktop Linux', () => expect(platformFromUserAgent('Mozilla/5.0 (X11; Linux x86_64)')).toBe('linux'));
  it('reads Windows', () => expect(platformFromUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64)')).toBe('windows'));
  it('reads iPhone', () => expect(platformFromUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)')).toBe('ios'));
  it('reads a real Mac as macos', () => {
    expect(platformFromUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 0)).toBe('macos');
  });
  it('reads a touch "Mac" as ios — iPads have claimed to be Macs since iPadOS 13', () => {
    expect(platformFromUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5)).toBe('ios');
  });
  it('gives up quietly on something unrecognisable', () => expect(platformFromUserAgent('curl/8.5.0')).toBe(''));
});
describe('preferredPlatform', () => {
  it('opens on the visitor’s own platform when it has shots', () => {
    expect(preferredPlatform(['android','linux'], 'linux')).toBe('linux');
  });
  it('falls back to the first platform available', () => {
    expect(preferredPlatform(['android','linux'], 'windows')).toBe('android');
  });
  it('is empty when there are no platforms at all', () => expect(preferredPlatform([], 'android')).toBe(''));
});
describe('galleryHtml', () => {
  it('renders the selected platform’s shots with alt text and lazy loading', () => {
    const h = galleryHtml(timer, 'linux');
    expect(h).toContain('src="/registry/screenshots/dev.heyari.timer-0.2.0/linux/01-set.png"');
    expect(h).toContain('alt="Timer on Linux, screenshot 1"');
    expect(h).toContain('loading="lazy"');
    expect(h).not.toContain('android/01-set.webp');
  });
  it('marks the selected tab and offers the others', () => {
    const h = galleryHtml(timer, 'android');
    expect(h).toContain('<button class="shot-tab is-on" role="tab" aria-selected="true" data-platform="android">Android</button>');
    expect(h).toContain('<button class="shot-tab" role="tab" aria-selected="false" data-platform="linux">Linux</button>');
  });
  it('opens on the first platform when the requested one has no shots', () => {
    const h = galleryHtml(timer, 'windows');
    expect(h).toContain('android/01-set.webp');
    expect(h).toContain('aria-selected="true" data-platform="android"');
  });
  it('records which platform it rendered, so a prerendered page can swap it', () => {
    expect(galleryHtml(timer, 'linux')).toContain('<div class="d-shots" data-platform="linux">');
    // Also correct when the request falls back rather than matching.
    expect(galleryHtml(timer, 'windows')).toContain('<div class="d-shots" data-platform="android">');
  });
  it('renders against the live registry when handed that base', () => {
    expect(galleryHtml(timer, 'linux', REGISTRY_BASE))
      .toContain(`src="${REG}screenshots/dev.heyari.timer-0.2.0/linux/01-set.png"`);
  });
  it('drops the tab bar when there is only one platform', () => {
    const h = galleryHtml({ ...timer, screenshots: { android: [shot('android','01-set.webp')] } }, 'android');
    expect(h).not.toContain('shot-tabs');
    expect(h).toContain('android/01-set.webp');
  });
  it('keeps the coming-soon card for skills with no screenshots', () => {
    expect(galleryHtml(coin, 'android')).toContain('Screenshot coming soon');
  });
});
describe('detailHtml screenshots', () => {
  it('shows the gallery in place of the placeholder', () => {
    const h = detailHtml(timer, 'android');
    expect(h).toContain('class="shot-strip"');
    expect(h).not.toContain('Screenshot coming soon');
  });
  it('still shows the placeholder for an unphotographed skill', () => {
    expect(detailHtml(coin, 'android')).toContain('Screenshot coming soon');
  });
});

describe('metaDescription', () => {
  it('passes a short description through untouched', () => {
    expect(metaDescription(coin)).toBe('Flips a coin.');
  });
  it('collapses the newlines registry descriptions carry', () => {
    expect(metaDescription({ description: 'Use Gemini.\nSends your questions to Google.\n' }))
      .toBe('Use Gemini. Sends your questions to Google.');
  });
  it('cuts on a word boundary and trims the dangling punctuation', () => {
    // 40 chars of text, cut at 20 → "The quick brown fox" then the ellipsis.
    expect(metaDescription({ description: 'The quick brown fox, jumps over the lazy dog' }, 20))
      .toBe('The quick brown fox…');
  });
  it('cuts mid-word only when there is no space to cut on', () => {
    expect(metaDescription({ description: 'Supercalifragilistic' }, 10)).toBe('Supercalif…');
  });
  it('is empty for a skill with no description at all', () => {
    expect(metaDescription({})).toBe('');
    expect(metaDescription(null)).toBe('');
  });
});

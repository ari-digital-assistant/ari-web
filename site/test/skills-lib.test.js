import { describe, it, expect } from 'vitest';
import { isNet, niceName, idFromPath, findSkill, filterSkills, cardHtml, detailHtml } from '../src/lib/skills.js';

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

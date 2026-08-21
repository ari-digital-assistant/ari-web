// Pure helpers for the skills browser. No DOM, no network — unit-tested.
const NET_CAPS = new Set(['http', 'authorize', 'media_services', 'navigation']);

// Screenshot paths in index.json are relative to the registry root, same
// as bundles and manifest sidecars.
export const REGISTRY_BASE = 'https://raw.githubusercontent.com/ari-digital-assistant/ari-skills/main/';

// Where the build mirrors those same paths, so loading a skill page never
// fetches an image from GitHub. Registry-relative paths keep their shape under
// it, which is what makes the mapping obvious in both directions.
export const MIRROR_BASE = '/registry/';

// Platform ids the registry publishes screenshots under, and how we spell
// them for people. Anything the validator doesn't recognise never reaches
// index.json, so an unknown id here means the registry is ahead of the
// site — show the raw id rather than dropping the screenshots on the floor.
const PLATFORM_LABELS = { android: 'Android', ios: 'iOS', linux: 'Linux', macos: 'macOS', windows: 'Windows' };

export const platformLabel = (p) => PLATFORM_LABELS[p] || p;

/** Platforms this skill has screenshots for, in registry order. */
export const screenshotPlatforms = (s) => Object.entries((s && s.screenshots) || {})
  .filter(([, files]) => files && files.length)
  .map(([platform]) => platform);

/**
 * Ordered screenshot URLs for one platform, against the mirror by default.
 * The one caller that passes REGISTRY_BASE instead is the /skills/detail
 * fallback: it only ever renders a skill published since the last build, whose
 * screenshots that build had no way to mirror.
 */
export const screenshotUrls = (s, platform, base = MIRROR_BASE) => (((s && s.screenshots) || {})[platform] || [])
  .map((path) => `${base}${path.replace(/^\/+/, '')}`);

/** Every registry-relative screenshot path a skill list references, deduped. */
export const screenshotPaths = (skills) => [...new Set(
  (skills || []).flatMap((s) => Object.values((s && s.screenshots) || {}).flat()),
)].map((path) => path.replace(/^\/+/, '')).sort();

/**
 * Best guess at the visitor's own platform, so the gallery opens on the
 * one they'd actually be installing on. Order matters: Android user
 * agents also say "Linux", and iPads have claimed to be Macs since
 * iPadOS 13, so the touch check is what separates them.
 */
export const platformFromUserAgent = (ua = '', maxTouchPoints = 0) => {
  const s = ua.toLowerCase();
  if (s.includes('android')) return 'android';
  if (/iphone|ipad|ipod/.test(s)) return 'ios';
  if (s.includes('windows')) return 'windows';
  if (s.includes('mac os x')) return maxTouchPoints > 1 ? 'ios' : 'macos';
  if (s.includes('linux')) return 'linux';
  return '';
};

/** The platform tab to open on: the visitor's own if we have shots for it. */
export const preferredPlatform = (platforms, hint) => (platforms.includes(hint) ? hint : platforms[0] || '');

export const isNet = (s) => s.type === 'assistant' || (s.capabilities || []).some((c) => NET_CAPS.has(c));

export const niceName = (name) => (name || '').replace(/-/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());

export const idFromPath = (pathname) => {
  const m = (pathname || '').replace(/\/+$/, '').match(/\/skills\/(.+)$/);
  return m ? m[1] : '';
};

/**
 * A one-line description for <meta> and OG cards. Registry descriptions run to
 * several sentences and carry newlines; unfurlers want one tidy line, cut on a
 * word so it doesn't end mid-syllable.
 */
export const metaDescription = (s, max = 155) => {
  const text = ((s && s.description) || '').replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  // If the very next character is a space, `cut` already ends on a whole word —
  // dropping back to the last space would throw that word away for nothing.
  const space = cut.lastIndexOf(' ');
  const kept = text[max] === ' ' || space <= 0 ? cut : cut.slice(0, space);
  return `${kept.replace(/[.,;:]+$/, '')}…`;
};

export const findSkill = (skills, id) => (skills || []).find((s) => s.id === id);

export const filterSkills = (skills, { type = 'all', query = '' } = {}) => {
  const q = query.trim().toLowerCase();
  return (skills || []).filter((s) => {
    const okType = type === 'all' ? true : type === 'local' ? !isNet(s) : s.type === type;
    const hay = `${s.name} ${s.description} ${(s.capabilities || []).join(' ')} ${s.id}`.toLowerCase();
    return okType && (!q || hay.includes(q));
  });
};

const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const caps = (s) => (s.capabilities && s.capabilities.length
  ? s.capabilities.map((c) => `<span class="cap">${esc(c)}</span>`).join('')
  : '<span class="cap">no permissions</span>');

const priv = (s) => (isNet(s)
  ? '<span class="priv net"><span class="dot"></span>uses network</span>'
  : '<span class="priv local"><span class="dot"></span>on-device</span>');

export const cardHtml = (s) => `<a class="card" href="/skills/${esc(s.id)}" data-type="${esc(s.type)}" data-net="${isNet(s)}">
  <div class="card-top">
    <div><h3>${esc(niceName(s.name))}</h3><div class="id">${esc(s.id)}</div></div>
    <span class="badge ${esc(s.type)}">${esc(s.type)}</span>
  </div>
  <p class="desc">${esc(s.description)}</p>
  <div class="caps">${caps(s)}</div>
  <div class="card-foot">${priv(s)}<span class="open">View →</span></div>
</a>`;

/**
 * The preview panel: a platform tab bar over a scrolling strip of
 * screenshots, or the empty-state card for skills nobody has photographed
 * yet. `platform` is the tab to show; pass what `preferredPlatform`
 * returned. Unlike the app, the site shows every platform a skill has —
 * a visitor on a laptop is often deciding whether to install on a phone.
 */
export const galleryHtml = (s, platform, base) => {
  const platforms = screenshotPlatforms(s);
  if (!platforms.length) {
    return '<div class="d-preview"><div class="inner"><b>In-app preview</b><span>Screenshot coming soon</span></div></div>';
  }
  const on = preferredPlatform(platforms, platform);
  const tabs = platforms.length > 1
    ? `<div class="shot-tabs" role="tablist" aria-label="Platform">${platforms.map((p) => `<button class="shot-tab${p === on ? ' is-on' : ''}" role="tab" aria-selected="${p === on}" data-platform="${esc(p)}">${esc(platformLabel(p))}</button>`).join('')}</div>`
    : '';
  const shots = screenshotUrls(s, on, base).map((url, i) => `<img class="shot" src="${esc(url)}" loading="lazy" alt="${esc(niceName(s.name))} on ${esc(platformLabel(on))}, screenshot ${i + 1}">`).join('');
  // data-platform lets a prerendered page tell which platform the BUILD picked,
  // so the client only swaps the gallery when the reader's own differs.
  return `<div class="d-shots" data-platform="${esc(on)}">${tabs}<div class="shot-strip">${shots}</div></div>`;
};

// NOTE: `v` is injected as raw HTML, not escaped — callers must pass
// already-escaped/trusted content (e.g. esc(...) output or markup we built
// ourselves), never a raw registry field.
const fact = (k, v) => `<div class="fact"><span class="k">${esc(k)}</span><span class="v">${v}</span></div>`;

export const detailHtml = (s, platform, base) => {
  const net = isNet(s);
  const banner = net
    ? '<div class="priv-banner net"><span class="dot"></span><div><div class="t">Uses the network</div><div class="s">This skill reaches the internet for some tasks — only when a request needs it.</div></div></div>'
    : '<div class="priv-banner local"><span class="dot"></span><div><div class="t">Runs entirely on your device</div><div class="s">Nothing this skill does needs the internet.</div></div></div>';
  const home = /^https?:\/\//i.test(s.homepage || '') ? `<a href="${esc(s.homepage)}">GitHub ↗</a>` : '—';
  return `<div class="d-hero">
    <div><h1>${esc(niceName(s.name))}</h1><div class="id">${esc(s.id)}</div>
      <div class="d-meta"><span class="badge ${esc(s.type)}">${esc(s.type)}</span><span class="ver">v${esc(s.version)}</span><span class="ver">${esc(s.author)}</span></div>
    </div>
  </div>
  ${galleryHtml(s, platform, base)}
  <div class="d-section"><h2>About this skill</h2><p class="body">${esc(s.description)}</p>${banner}</div>
  <div class="d-section"><h2>Skill detail</h2><div class="facts">
    ${fact('Author', esc(s.author))}
    ${fact('Version', esc(s.version))}
    ${fact('Homepage', home)}
    ${fact('License', esc(s.license))}
    ${fact('Languages', (s.languages || []).map((l) => esc(l.toUpperCase())).join(' · '))}
    ${fact('Capabilities', `<span class="caps-list">${caps(s)}</span>`)}
  </div></div>
  <div class="d-note">Skills install from inside Ari. Get the app, then add this skill from Settings → Skills. <span class="sub">Already have Ari? Opening this link on your phone opens the skill in the app.</span></div>
  <div class="d-actions"><a class="btn btn-primary" href="/#get">Get Ari</a><a class="btn btn-ghost" href="/skills">All skills</a></div>`;
};

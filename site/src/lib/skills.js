// Pure helpers for the skills browser. No DOM, no network — unit-tested.
const NET_CAPS = new Set(['http', 'authorize', 'media_services', 'navigation']);

export const isNet = (s) => s.type === 'assistant' || (s.capabilities || []).some((c) => NET_CAPS.has(c));

export const niceName = (name) => (name || '').replace(/-/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());

export const idFromPath = (pathname) => {
  const m = (pathname || '').replace(/\/+$/, '').match(/\/skills\/(.+)$/);
  return m ? m[1] : '';
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

// NOTE: `v` is injected as raw HTML, not escaped — callers must pass
// already-escaped/trusted content (e.g. esc(...) output or markup we built
// ourselves), never a raw registry field.
const fact = (k, v) => `<div class="fact"><span class="k">${esc(k)}</span><span class="v">${v}</span></div>`;

export const detailHtml = (s) => {
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
  <div class="d-preview"><div class="inner"><b>In-app preview</b><span>Screenshot coming soon</span></div></div>
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

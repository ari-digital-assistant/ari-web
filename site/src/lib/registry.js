// Build-time access to the skill registry. Deliberately NOT in lib/skills.js:
// that module is pure and unit-tested with no I/O, and this one is nothing but
// I/O. One fetch per build serves both the /skills.json mirror and the
// prerendered skill pages.
const INDEX_URL = 'https://raw.githubusercontent.com/ari-digital-assistant/ari-skills/main/index.json';

let pending;

export function registryIndex() {
  pending ??= fetch(INDEX_URL).then(async (res) => {
    if (!res.ok) throw new Error(`Registry index ${INDEX_URL} returned ${res.status}. The build mirrors it to /skills.json and prerenders a page per skill, so it can't continue without it.`);
    return res.json();
  });
  return pending;
}

export const registrySkills = async () => (await registryIndex()).skills || [];

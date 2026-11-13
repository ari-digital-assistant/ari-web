// Build-time access to the skill registry. Deliberately NOT in lib/skills.js:
// that module is pure and unit-tested with no I/O, and this one is nothing but
// I/O. One fetch per build serves both the /skills.json mirror and the
// prerendered skill pages.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { REGISTRY_BASE } from './skills.js';

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

// A screenshot path carries the skill version, so the bytes behind a given path
// never change — worth keeping between builds, because `npm test` runs the site
// build once per suite and would otherwise refetch all of them each time. Wipe
// node_modules/.cache to force a refetch.
//
// Anchored on the working directory, not import.meta.url: the build bundles
// this module into a chunk whose depth has nothing to do with src/lib/. Every
// way the site gets built (npm run build/dev --workspace site, deploy.sh,
// the test suites) runs astro with site/ as the working directory.
const CACHE = new URL('../node_modules/.cache/ari-web-registry/', pathToFileURL(`${process.cwd()}/`));

/** One registry file's bytes, by registry-relative path, cached across builds. */
export async function registryFile(path) {
  const cached = new URL(path, CACHE);
  let bytes = await readFile(cached).catch(() => null);
  if (!bytes) {
    const url = `${REGISTRY_BASE}${path}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Screenshot ${url} returned ${res.status}. It is listed in the registry index, so either the index is wrong or the file was removed without a reindex.`);
    bytes = Buffer.from(await res.arrayBuffer());
    await mkdir(dirname(fileURLToPath(cached)), { recursive: true });
    await writeFile(cached, bytes);
  }
  return bytes;
}

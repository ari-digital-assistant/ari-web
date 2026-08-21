import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registrySkills } from '../../lib/registry.js';
import { screenshotPaths, REGISTRY_BASE } from '../../lib/skills.js';

// The registry's screenshots, copied into the site at build time. Without this
// every skill page made a GitHub request per image, which told a third party
// exactly which skill someone was reading about. Paths keep their registry
// shape, so /registry/screenshots/<skill>-<version>/<platform>/<n>.webp mirrors
// screenshots/<skill>-<version>/<platform>/<n>.webp one for one.

// A screenshot path carries the skill version, so the bytes behind a given path
// never change — worth keeping between builds, because `npm test` runs the site
// build once per suite and would otherwise refetch all of them each time. Wipe
// node_modules/.cache to force a refetch.
const CACHE = new URL('../../../../node_modules/.cache/ari-web-registry/', import.meta.url);

// The build writes these as plain files and S3 sets the real Content-Type from
// the extension on upload, so this only dresses up `astro dev` and `preview`.
const TYPES = { webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' };

export async function getStaticPaths() {
  return screenshotPaths(await registrySkills()).map((path) => ({ params: { path } }));
}

export async function GET({ params }) {
  const cached = new URL(params.path, CACHE);
  let bytes = await readFile(cached).catch(() => null);
  if (!bytes) {
    const url = `${REGISTRY_BASE}${params.path}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Screenshot ${url} returned ${res.status}. It is listed in the registry index, so either the index is wrong or the file was removed without a reindex.`);
    bytes = Buffer.from(await res.arrayBuffer());
    await mkdir(dirname(fileURLToPath(cached)), { recursive: true });
    await writeFile(cached, bytes);
  }
  const type = TYPES[params.path.slice(params.path.lastIndexOf('.') + 1).toLowerCase()];
  return new Response(bytes, { headers: { 'content-type': type || 'application/octet-stream' } });
}

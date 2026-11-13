import { registrySkills, registryFile } from '../../lib/registry.js';
import { screenshotPaths } from '../../lib/skills.js';

// The registry's screenshots, copied into the site at build time. Without this
// every skill page made a GitHub request per image, which told a third party
// exactly which skill someone was reading about. Paths keep their registry
// shape, so /registry/screenshots/<skill>-<version>/<platform>/<n>.webp mirrors
// screenshots/<skill>-<version>/<platform>/<n>.webp one for one.

// The build writes these as plain files and S3 sets the real Content-Type from
// the extension on upload, so this only dresses up `astro dev` and `preview`.
const TYPES = { webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' };

export async function getStaticPaths() {
  return screenshotPaths(await registrySkills()).map((path) => ({ params: { path } }));
}

export async function GET({ params }) {
  const bytes = await registryFile(params.path);
  const type = TYPES[params.path.slice(params.path.lastIndexOf('.') + 1).toLowerCase()];
  return new Response(bytes, { headers: { 'content-type': type || 'application/octet-stream' } });
}

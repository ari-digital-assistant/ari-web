import { rm, cp, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const dist = root + 'dist';
const siteDist = root + 'site/dist';
const docsDist = root + 'docs/.vitepress/dist'; // present from Phase 3 onward

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await cp(siteDist, dist, { recursive: true });

// VitePress docs mount at /docs — copied only if they've been built.
try {
  await cp(docsDist, dist + '/docs', { recursive: true });
  console.log('assembled: site + docs');
} catch {
  console.log('assembled: site only (docs not built yet)');
}

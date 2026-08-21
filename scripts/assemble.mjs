import { rm, cp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const dist = root + 'dist';
const build = root + 'build';
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

// The routing function needs to know which skill ids got a prerendered page, so
// it can send the rest to the client-rendered template. Read that from the
// assembled tree rather than from the registry: dist/skills/ IS the answer, so
// the two can't drift. The result goes to build/, never to dist/ — it is
// published to CloudFront by deploy.sh, not served out of the bucket.
const skillIds = (await readdir(dist + '/skills', { withFileTypes: true }))
  .filter((e) => e.isDirectory() && e.name !== 'detail')
  .map((e) => e.name)
  .sort();

// VitePress with cleanUrls writes flat <name>.html files, except for section
// indexes, which stay <dir>/index.html. The routing function has no way to tell
// the two apart from the URL, so hand it the list of directories the docs build
// actually produced.
const docsDirs = [];
const walkDocs = async (dir, uri) => {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const child = `${dir}/${entry.name}`;
    if (existsSync(`${child}/index.html`)) docsDirs.push(`${uri}/${entry.name}`);
    await walkDocs(child, `${uri}/${entry.name}`);
  }
};
if (existsSync(dist + '/docs')) await walkDocs(dist + '/docs', '/docs');
docsDirs.sort();

const inject = (src, marker, value) => {
  if (!src.includes(marker)) throw new Error(`cf-rewrite.js no longer contains "${marker}", so the routing function cannot be built. Restore the line or update scripts/assemble.mjs.`);
  return src.replace(marker, `${marker.slice(0, -3)}${JSON.stringify(value)};`);
};

let fn = await readFile(root + 'cf-rewrite.js', 'utf8');
fn = inject(fn, 'var PRERENDERED = [];', skillIds);
fn = inject(fn, 'var DOCS_DIRS = [];', docsDirs);

await mkdir(build, { recursive: true });
await writeFile(build + '/cf-rewrite.js', fn);
console.log(`routing function: ${skillIds.length} prerendered skill ids, ${docsDirs.length} docs section indexes -> build/cf-rewrite.js`);

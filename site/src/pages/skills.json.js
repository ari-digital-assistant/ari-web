import { registryIndex } from '../lib/registry.js';

// Same-origin mirror of the registry index, baked in at build time. The grid
// and the skill pages read this instead of raw.githubusercontent.com, so a
// visitor browsing skills never hands GitHub a request. It is as fresh as the
// last deploy rather than live — see the registry→rebuild note in the design.
export async function GET() {
  return new Response(JSON.stringify(await registryIndex()), {
    headers: { 'content-type': 'application/json' },
  });
}

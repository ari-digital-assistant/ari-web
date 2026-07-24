import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.js', 'site/test/**/*.test.js'],
    environment: 'node',
    // Build-based suites each run `astro build` into the shared site/dist,
    // so they must not run concurrently or the two builds clobber each other.
    fileParallelism: false,
  },
});

import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import mdx from '@astrojs/mdx';

// English-first, i18n-ready: `en` default with no prefix; `it` reserved.
export default defineConfig({
  site: 'https://heyari.dev',
  build: { format: 'directory' }, // <route>/index.html — matches cf-rewrite.js
  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
    routing: { prefixDefaultLocale: false },
  },
  integrations: [mdx(), sitemap()],
});

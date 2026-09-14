import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import mdx from '@astrojs/mdx';

// English-first, i18n-ready: `en` default with no prefix; `it` reserved.
export default defineConfig({
  site: 'https://heyari.dev',
  build: { format: 'directory' }, // <route>/index.html — matches cf-rewrite.js
  // The home page shelf resizes registry screenshots down to thumbnails, which
  // Astro will only do for a host named here. Build-time only: the thumbnails
  // it writes are served from our own origin, same as the /registry mirror.
  image: { domains: ['raw.githubusercontent.com'] },
  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
    routing: { prefixDefaultLocale: false },
  },
  integrations: [
    mdx(),
    sitemap({
      // /skills/detail is a routing target, not a page anyone should land on
      // from search — every real skill has its own prerendered URL now.
      filter: (page) => !page.includes('/skills/detail'),
      // `directory` format makes Astro write /privacy/ and /skills/<id>/, but
      // every link on the site — and the App Link the app opens — is the bare
      // form. Advertise the URLs people actually share.
      serialize: (item) => ({
        ...item,
        url: new URL(item.url).pathname === '/' ? item.url : item.url.replace(/\/$/, ''),
      }),
    }),
  ],
});

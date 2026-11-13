import { defineConfig, type HeadConfig } from 'vitepress'

const SITE = 'https://heyari.dev'
const DESCRIPTION = 'Documentation for Ari — the open-source, on-device assistant.'

// Link previews, matching what site/src/layouts/Base.astro gives the rest of
// heyari.dev. The card is the site's own (/og/ari.jpg, outside /docs): docs and
// site are assembled into one bucket, so it is always there.
const IMAGE = {
  src: `${SITE}/og/ari.jpg`,
  alt: 'Ari — the assistant that never phones home. Open-source, on-device, yours.',
}

export default defineConfig({
  lang: 'en-GB',
  title: 'Ari Docs',
  description: DESCRIPTION,
  base: '/docs/',
  cleanUrls: true,
  head: [
    ['link', { rel: 'icon', href: '/docs/favicon.svg' }],
    ['link', { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' }],
    ['meta', { name: 'theme-color', content: '#D8431C' }],
  ],
  transformHead({ pageData }) {
    // cleanUrls: using/wake-word.md is served as /docs/using/wake-word, and a
    // section index (develop/index.md) as /docs/develop/ — the trailing slash
    // is the URL cf-rewrite resolves, so it is the one to share.
    const path = pageData.relativePath.replace(/(^|\/)index\.md$/, '$1').replace(/\.md$/, '')
    const url = `${SITE}/docs/${path}`
    const title = pageData.title ? `${pageData.title} | Ari Docs` : 'Ari Docs'
    const description = pageData.description || DESCRIPTION
    const og = (property: string, content: string): HeadConfig => ['meta', { property, content }]
    const tw = (name: string, content: string): HeadConfig => ['meta', { name, content }]
    return [
      ['link', { rel: 'canonical', href: url }],
      og('og:type', 'website'),
      og('og:site_name', 'Ari'),
      og('og:locale', 'en_GB'),
      og('og:title', title),
      og('og:description', description),
      og('og:url', url),
      og('og:image', IMAGE.src),
      og('og:image:width', '1200'),
      og('og:image:height', '630'),
      og('og:image:alt', IMAGE.alt),
      tw('twitter:card', 'summary_large_image'),
      tw('twitter:title', title),
      tw('twitter:description', description),
      tw('twitter:image', IMAGE.src),
      tw('twitter:image:alt', IMAGE.alt),
    ]
  },
  themeConfig: {
    logo: '/docs/favicon.svg',
    nav: [
      { text: 'Using Ari', link: '/using/getting-started' },
      { text: 'Develop', link: '/develop/' },
      { text: 'heyari.dev', link: 'https://heyari.dev' },
    ],
    sidebar: {
      '/using/': [
        {
          text: 'Using Ari',
          items: [
            { text: 'Getting started', link: '/using/getting-started' },
            { text: 'The wake word', link: '/using/wake-word' },
            { text: 'Skills', link: '/using/skills' },
            { text: 'Privacy & your data', link: '/using/privacy' },
          ],
        },
      ],
      '/develop/': [
        {
          text: 'Develop',
          items: [
            { text: 'Overview', link: '/develop/' },
            { text: 'Your first skill', link: '/develop/first-skill' },
          ],
        },
      ],
    },
    socialLinks: [
      { icon: 'github', link: 'https://github.com/ari-digital-assistant' },
    ],
    search: { provider: 'local' },
  },
})

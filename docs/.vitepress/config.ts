import { defineConfig } from 'vitepress'

export default defineConfig({
  lang: 'en-GB',
  title: 'Ari Docs',
  description: 'Documentation for Ari — the open-source, on-device assistant.',
  base: '/docs/',
  cleanUrls: true,
  head: [
    ['link', { rel: 'icon', href: '/docs/favicon.svg' }],
    ['meta', { name: 'theme-color', content: '#D8431C' }],
  ],
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

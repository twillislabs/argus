import type * as Preset from '@docusaurus/preset-classic';
import type { Config } from '@docusaurus/types';
import { themes as prismThemes } from 'prism-react-renderer';

// Served by the Argus web container at /docs/. For GitHub Pages, CI
// overrides url and baseUrl with DOCS_URL and DOCS_BASE_URL.
const config: Config = {
  title: 'Argus',
  tagline: 'Self-hosted OSINT visualizer',
  favicon: 'img/favicon.svg',
  url: process.env.DOCS_URL ?? 'http://localhost',
  baseUrl: process.env.DOCS_BASE_URL ?? '/docs/',
  onBrokenLinks: 'throw',
  markdown: {
    mermaid: true,
    hooks: { onBrokenMarkdownLinks: 'throw' },
  },
  themes: [
    '@docusaurus/theme-mermaid',
    // Search, built into the site at build time: no outside service.
    [
      '@easyops-cn/docusaurus-search-local',
      {
        hashed: true,
        indexBlog: false,
        docsRouteBasePath: '/',
        highlightSearchTermsOnTargetPage: true,
        searchBarShortcutHint: true,
      },
    ],
  ],
  clientModules: ['./src/fonts.ts'],
  i18n: { defaultLocale: 'en', locales: ['en'] },
  presets: [
    [
      'classic',
      {
        docs: {
          routeBasePath: '/',
          sidebarPath: './sidebars.ts',
        },
        blog: false,
        theme: { customCss: './src/css/custom.css' },
      } satisfies Preset.Options,
    ],
  ],
  themeConfig: {
    colorMode: { defaultMode: 'dark', respectPrefersColorScheme: false },
    mermaid: { theme: { light: 'neutral', dark: 'dark' } },
    navbar: {
      title: 'ARGUS',
      logo: { alt: 'Argus', src: 'img/favicon.svg' },
      items: [
        { type: 'docSidebar', sidebarId: 'docs', position: 'left', label: 'Docs' },
        // Raw HTML so Docusaurus doesn't prefix the base URL (/docs/):
        // this link leaves the docs and opens the Argus app at /.
        {
          type: 'html',
          position: 'right',
          value: '<a class="navbar__item navbar__link" href="/">Open Argus</a>',
        },
        { href: 'https://github.com/twillislabs/argus', label: 'GitHub', position: 'right' },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Project',
          items: [
            { label: 'Source code (GitHub)', href: 'https://github.com/twillislabs/argus' },
            { label: 'Releases', href: 'https://github.com/twillislabs/argus/releases' },
            { label: 'Report an issue', href: 'https://github.com/twillislabs/argus/issues' },
          ],
        },
      ],
      copyright: 'Argus · self-hosted OSINT visualizer · Apache License 2.0',
    },
    prism: { theme: prismThemes.github, darkTheme: prismThemes.dracula },
  } satisfies Preset.ThemeConfig,
};

export default config;

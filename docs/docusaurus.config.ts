import { themes as prismThemes } from 'prism-react-renderer';
import type { Config } from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const config: Config = {
  title: 'React Native Wi-Fi',
  tagline: 'Wi-Fi for React Native',

  future: {
    v4: true,
  },

  // `future.v4` turns off `## Heading {#id}`; the Chinese pages keep each English anchor with it.
  markdown: {
    mdx1Compat: { headingIds: true },
  },

  url: 'https://wekor.github.io',
  baseUrl: process.env.DOCUSAURUS_BASE_URL ?? '/',
  organizationName: 'wekor',
  projectName: 'react-native-wifi',

  favicon: 'img/logo.svg',
  onBrokenLinks: 'throw',

  stylesheets: [
    {
      href: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap',
      type: 'text/css',
    },
  ],

  i18n: {
    defaultLocale: 'en',
    locales: ['en', 'zh-Hans'],
    localeConfigs: {
      en: { label: 'English', htmlLang: 'en' },
      'zh-Hans': { label: '简体中文', htmlLang: 'zh-Hans' },
    },
  },

  presets: [
    [
      'classic',
      {
        docs: {
          path: './content',
          routeBasePath: '/',
          breadcrumbs: false,
          sidebarPath: './sidebars.ts',
          editUrl:
            'https://github.com/wekor/react-native-wifi/tree/main/docs/',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    colorMode: {
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: 'React Native Wi-Fi',
      logo: { alt: '', src: 'img/logo.svg' },
      items: [
        { to: '/', label: 'Docs', position: 'left', activeBaseRegex: '^/(?!api)' },
        { to: '/api', label: 'API reference', position: 'left' },
        { type: 'localeDropdown', position: 'right' },
        { href: 'https://www.npmjs.com/package/@wekor/react-native-wifi', label: 'npm', position: 'right' },
        { href: 'https://github.com/wekor/react-native-wifi', label: 'GitHub', position: 'right' },
      ],
    },
    footer: {
      copyright: `© ${new Date().getFullYear()} wekor · MIT License`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.vsDark,
    },
  } satisfies Preset.ThemeConfig,
};

export default config;

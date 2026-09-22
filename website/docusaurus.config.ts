import type { Config } from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';
import { themes } from 'prism-react-renderer';

/**
 * Docs link to package READMEs outside docs/ (e.g. ../cli/README.md).
 * Those targets aren't part of the site — send them to GitHub instead.
 */
function rewriteRepoLinks(): (tree: unknown) => void {
  const REPO = 'https://github.com/balureddy003/Naro/blob/main/';
  const visit = (node: { type?: string; url?: string; children?: unknown[] }): void => {
    if (node.type === 'link' && node.url?.startsWith('../')) {
      node.url = REPO + node.url.replace(/^\.\.\//, '');
    }
    for (const c of node.children ?? []) visit(c as typeof node);
  };
  return (tree) => visit(tree as Parameters<typeof visit>[0]);
}

const config: Config = {
  title: 'Naro',
  tagline: 'Infrastructure for the agent ecosystem',
  url: 'https://balureddy003.github.io',
  baseUrl: '/Naro/',
  favicon: 'img/favicon.svg',
  organizationName: 'balureddy003',
  projectName: 'Naro',
  onBrokenLinks: 'warn',
  markdown: {
    format: 'detect',
    hooks: { onBrokenMarkdownLinks: 'warn' },
  },
  i18n: { defaultLocale: 'en', locales: ['en'] },
  presets: [
    [
      'classic',
      {
        docs: {
          // The canonical docs corpus lives at repo root — render it in place.
          path: '../docs',
          routeBasePath: '/',
          sidebarPath: './sidebars.ts',
          editUrl: 'https://github.com/balureddy003/Naro/tree/main/',
          showLastUpdateTime: true,
          remarkPlugins: [rewriteRepoLinks],
        },
        blog: false,
        theme: { customCss: './src/css/custom.css' },
      } satisfies Preset.Options,
    ],
  ],
  themeConfig: {
    navbar: {
      title: 'Naro',
      items: [
        { to: '/getting-started', label: 'Start', position: 'left' },
        { to: '/learn/how-llms-work', label: 'Learn', position: 'left' },
        { to: '/architecture', label: 'Architecture', position: 'left' },
        { to: '/adr/', label: 'ADRs', position: 'left' },
        { href: 'https://github.com/balureddy003/Naro', label: 'GitHub', position: 'right' },
      ],
    },
    footer: {
      style: 'dark',
      copyright: `Apache-2.0 · Naro ${new Date().getFullYear()}`,
    },
    prism: {
      theme: themes.github,
      darkTheme: themes.dracula,
      additionalLanguages: ['bash', 'json', 'yaml'],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;

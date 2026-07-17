import { defineConfig } from 'astro/config'
import starlight from '@astrojs/starlight'

export default defineConfig({
  site: 'https://osra.banou.dev',
  integrations: [
    starlight({
      title: 'osra',
      description:
        'Documentation for osra, the zero-dependency TypeScript RPC library that connects two JavaScript contexts over any message channel.',
      logo: { src: './src/assets/logo.svg', alt: 'osra' },
      favicon: '/favicon.svg',
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/Banou26/osra' },
        { icon: 'npm', label: 'npm', href: 'https://www.npmjs.com/package/osra' },
      ],
      components: {
        Header: './src/components/Header.astro',
      },
      sidebar: [
        {
          label: 'Start here',
          items: [
            { label: 'Getting started', slug: 'start/getting-started' },
          ],
        },
        {
          label: 'Guides',
          items: [
            { label: 'Transports', slug: 'guides/transports' },
            { label: 'Supported types', slug: 'guides/supported-types' },
            { label: 'identity() and transfer()', slug: 'guides/identity-and-transfer' },
            { label: 'Errors and lifecycle', slug: 'guides/lifecycle' },
            { label: 'Multi-peer connections', slug: 'guides/multi-peer' },
            { label: 'Custom transports', slug: 'guides/custom-transports' },
            { label: 'Custom revivables', slug: 'guides/custom-revivables' },
            { label: 'Security and trust', slug: 'guides/security' },
            { label: 'Performance', slug: 'guides/performance' },
          ],
        },
        {
          label: 'Reference',
          items: [
            { label: 'expose()', slug: 'reference/expose' },
            { label: 'Remote<T> and TypeScript', slug: 'reference/typescript' },
            { label: 'identity()', slug: 'reference/identity' },
            { label: 'transfer()', slug: 'reference/transfer' },
            { label: 'relay()', slug: 'reference/relay' },
            { label: 'Type guards', slug: 'reference/type-guards' },
            { label: 'Low-level messaging', slug: 'reference/low-level' },
            { label: 'Wire protocol', slug: 'reference/wire-protocol' },
            { label: 'Limitations', slug: 'reference/limitations' },
          ],
        },
        {
          label: 'Internals',
          collapsed: true,
          items: [
            { label: 'Architecture', slug: 'internals/architecture' },
            { label: 'The handshake', slug: 'internals/handshake' },
            { label: 'JSON vs clone transports', slug: 'internals/json-vs-clone' },
          ],
        },
      ],
      customCss: ['@fontsource-variable/inter', './src/styles/custom.css'],
    }),
  ],
})

import { defineEcConfig } from 'astro-expressive-code'
import ecTwoSlash from 'expressive-code-twoslash'
import { definePlugin } from '@expressive-code/core'

// TS quickinfo prints `typeof import("<abs path>/node_modules/osra/build/…")`
// in hover popups; strip the machine-specific prefix so popups read
// `import("osra/build/…")` and build output is identical across machines.
const stripNodeModulesPaths = () =>
  definePlugin({
    name: 'osra-strip-node-modules-paths',
    hooks: {
      postprocessRenderedBlock({ renderData }) {
        const walk = (node) => {
          if (node.type === 'text' && node.value.includes('/node_modules/')) {
            node.value = node.value.replace(/(?:\/[^\s"')]+)?\/node_modules\//g, '')
          }
          for (const child of node.children ?? []) walk(child)
        }
        walk(renderData.blockAst)
      },
    },
  })

// Blocks tagged ```ts twoslash are type-checked against the PUBLISHED osra package at build time and
// render hover popups with the real types. Keep compilerOptions in sync with
// scripts/check-twoslash.mjs, which is the fast per-file checker.
//
// A failing block does NOT fail the build. It silently drops the whole page's body, so the page
// deploys as a title and nav with no content, and the build still reports success. Documenting an
// unreleased API therefore blanks every page that mentions it until the release lands. Run
// `npm run docs-check-twoslash` before pushing docs; a red result there is a blank page, not a
// warning.
export default defineEcConfig({
  // Inline the EC styles into each page instead of the shared ec.*.css asset.
  // The external file put every token color and code background in one extra
  // request; when that transfer was interrupted mid-download (observed as
  // intermittently colorless code blocks on refresh in Firefox), the parsed
  // prefix styled the frames but the theme sections at the tail never arrived.
  emitExternalStylesheet: false,
  themes: ['github-dark', 'github-light'],
  plugins: [
    ecTwoSlash({
      twoslashOptions: {
        compilerOptions: {
          target: 99,
          module: 99,
          moduleResolution: 100,
          lib: ['lib.esnext.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
          strict: true,
        },
      },
    }),
    stripNodeModulesPaths(),
  ],
})

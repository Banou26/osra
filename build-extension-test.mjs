// Builds the test extension for the Playwright extension suite.
//
// Each entry (background, content, popup) must be self-contained - content
// scripts and MV3 service workers can't share chunks - so we run vite once
// per entry rather than relying on rollup multi-input.
//
// This used to be a vite config (`vite.extension-test.config.ts`) that
// triggered three nested `viteBuild()` calls from a `buildStart` plugin
// hook. With `formats: []` on the outer config, vite 8 returns before
// plugin hooks fire, leaving the build silently empty.

import { build as viteBuild } from 'vite'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { copyFile, mkdir, rm } from 'node:fs/promises'

const __dirname = dirname(fileURLToPath(import.meta.url))
const outDir = resolve(__dirname, 'build/extension-test')

const buildEntry = (name, entry) =>
  viteBuild({
    configFile: false,
    build: {
      target: 'esnext',
      outDir,
      emptyOutDir: false,
      sourcemap: true,
      minify: false,
      lib: {
        entry,
        name,
        fileName: () => `${name}.js`,
        formats: ['es'],
      },
    },
    logLevel: 'warn',
  })

await rm(outDir, { recursive: true }).catch(() => {})
await mkdir(outDir, { recursive: true })

console.log('[ext-build] background.js')
await buildEntry('background', resolve(__dirname, 'tests/extension/background.ts'))

console.log('[ext-build] content.js')
await buildEntry('content', resolve(__dirname, 'tests/extension/content.ts'))

console.log('[ext-build] popup.js')
await buildEntry('popup', resolve(__dirname, 'tests/extension/popup.ts'))

await copyFile(
  resolve(__dirname, 'tests/extension/manifest.json'),
  resolve(outDir, 'manifest.json'),
)
await copyFile(
  resolve(__dirname, 'tests/extension/popup.html'),
  resolve(outDir, 'popup.html'),
)

console.log('[ext-build] done')

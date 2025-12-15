import { defineConfig, build as viteBuild } from 'vite'
import { resolve } from 'path'
import { copyFile, mkdir, rm } from 'fs/promises'
import topLevelAwait from 'vite-plugin-top-level-await'

const outDir = resolve(__dirname, 'build/extension-test')

const buildEntry = (name: string, entry: string) =>
  viteBuild({
    configFile: false,
    plugins: [topLevelAwait()],
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
      rollupOptions: {
        output: {
          inlineDynamicImports: true,
        },
      },
    },
    logLevel: 'warn',
  })

export default defineConfig({
  build: {
    target: 'esnext',
    outDir,
    emptyOutDir: false,
    // Use a dummy entry to prevent Vite from looking for index.html
    lib: {
      entry: resolve(__dirname, 'tests/extension/background.ts'),
      formats: [],
    },
  },
  plugins: [
    {
      name: 'build-extension-entries',
      enforce: 'pre',
      async buildStart() {
        await rm(outDir, { recursive: true }).catch(() => {})
        await mkdir(outDir, { recursive: true }).catch(() => {})

        console.log('[vite-extension] Building background.js...')
        await buildEntry('background', resolve(__dirname, 'tests/extension/background.ts'))

        console.log('[vite-extension] Building content.js...')
        await buildEntry('content', resolve(__dirname, 'tests/extension/content.ts'))

        console.log('[vite-extension] Building popup.js...')
        await buildEntry('popup', resolve(__dirname, 'tests/extension/popup.ts'))

        await copyFile(
          resolve(__dirname, 'tests/extension/manifest.json'),
          resolve(outDir, 'manifest.json')
        )
        await copyFile(
          resolve(__dirname, 'tests/extension/popup.html'),
          resolve(outDir, 'popup.html')
        )

        console.log('[vite-extension] Extension built successfully!')
      }
    }
  ]
})

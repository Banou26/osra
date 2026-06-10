import { defineConfig } from 'vite'
import istanbul from 'vite-plugin-istanbul'

export default defineConfig({
  plugins: [
    istanbul({
      include: 'src/*',
      exclude: ['node_modules', 'tests/'],
      extension: ['.js', '.ts'],
      requireEnv: false,
      forceBuildInstrument: true
    })
  ],
  build: {
    target: 'esnext',
    // NOT build/ — that's the publish root (files: ["build"]), and `npm pack`
    // doesn't run prepublishOnly, so a stray test bundle would ship.
    outDir: 'build-test',
    emptyOutDir: true,
    sourcemap: true,
    minify: false,
    lib: {
      name: 'osra',
      fileName: 'test',
      entry: 'tests/browser/_run.ts',
      formats: ['es']
    }
  }
})

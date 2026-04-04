import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    target: 'esnext',
    outDir: 'build',
    sourcemap: true,
    lib: {
      name: 'osra',
      fileName: 'index',
      entry: 'src/index.ts',
      formats: ['es']
    }
  }
})

import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    target: 'esnext',
    outDir: 'build',
    emptyOutDir: false,
    sourcemap: true,
    minify: false,
    terserOptions: {
      compress: false,
      mangle: false,
    },
    lib: {
      name: 'osra',
      fileName: 'test',
      entry: 'tests/_tests_.ts',
      formats: ['es']
    }
  }
})

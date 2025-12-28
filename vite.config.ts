import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'

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
  },
  plugins: [
    dts({
      include: ['src/**/*'],
      outDir: 'build',
      rollupTypes: true
    })
  ]
})

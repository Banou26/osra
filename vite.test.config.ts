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

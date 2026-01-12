import { defineConfig } from 'vitest/config'
import { playwright } from '@vitest/browser-playwright'

export default defineConfig({
  test: {
    browser: {
      provider: playwright(),
      enabled: true,
      headless: true,
      instances: [
        { browser: 'chromium' }
      ]
    },
    include: ['tests/browser/**/*.test.ts'],
    exclude: ['tests/browser/memory.test.ts'],
    // Run tests sequentially to avoid window.postMessage interference
    sequence: {
      concurrent: false
    },
    fileParallelism: false,
    coverage: {
      provider: 'istanbul',
      include: ['src/**'],
      exclude: ['node_modules', 'tests/'],
      reporter: ['text', 'json', 'html']
    },
    testTimeout: 10000
  }
})

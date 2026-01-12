import { defineConfig } from 'vitest/config'
import { playwright } from '@vitest/browser-playwright'
import { resolve } from 'path'

const extensionPath = resolve(__dirname, 'build/extension-test')

export default defineConfig({
  test: {
    browser: {
      provider: playwright({
        launch: {
          args: [
            `--disable-extensions-except=${extensionPath}`,
            `--load-extension=${extensionPath}`,
          ],
        },
        context: {
          // Extensions require non-headless mode
        }
      }),
      enabled: true,
      headless: false,
      instances: [
        { browser: 'chromium' }
      ]
    },
    include: ['tests/extension/**/*.test.ts'],
    testTimeout: 10000,
    hookTimeout: 30000
  }
})

import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  timeout: 5_000,
  fullyParallel: true,
  testDir: './tests/browser',
  testMatch: '**/*.spec.ts',
  webServer: {
    command: 'npm run start-server',
    url: 'http://localhost:3000'
  },
  use: {
    launchOptions: {
      devtools: true,
      // --js-flags=--expose-gc exposes globalThis.gc() for tests that need
      // deterministic collection to exercise FinalizationRegistry callbacks.
      args: ['--js-flags=--expose-gc'],
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    // {
    //   name: 'firefox',
    //   use: { ...devices['Desktop Firefox'] },
    // },
    // {
    //   name: 'webkit',
    //   use: { ...devices['Desktop Safari'] },
    // },
  ]
})

import { defineConfig } from '@playwright/test'

export default defineConfig({
  timeout: 60000,
  testDir: './tests',
  testMatch: 'test.spec.ts',
  // testDir: './tests/extension',
  // testMatch: '**/*.spec.ts',
  fullyParallel: false, // Extensions need sequential runs due to persistent context
  retries: 0,
  webServer: {
    command: 'npm run start-server',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
  },
  projects: [
    {
      name: 'chromium-extension',
      use: {
        browserName: 'chromium',
      },
    },
  ],
})

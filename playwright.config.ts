import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  // 5s is a deliberate hang-catcher locally; CI runners pay cold-start costs
  // (especially WebKit newPage) that need headroom plus one retry.
  timeout: process.env.CI ? 15_000 : 5_000,
  retries: process.env.CI ? 1 : 0,
  fullyParallel: true,
  testDir: './tests/browser',
  testMatch: '**/*.spec.ts',
  webServer: [
    {
      command: 'npm run start-server',
      url: 'http://localhost:3000'
    },
    {
      command: 'node tests/ws-relay.mjs',
      port: 3001
    },
  ],
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
  ]
})

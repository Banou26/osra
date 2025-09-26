import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  timeout: 5000000,
  // timeout: 5000,
  fullyParallel: true,
  webServer: {
    command: 'npm run start-server',
    url: 'http://localhost:3000'
  },
  use: {
    launchOptions: {
      devtools: true,
      args: [
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--disable-setuid-sandbox',
        '--no-sandbox',
        '--auto-open-devtools-for-tabs'
      ]
    },
    connectOptions: {
      wsEndpoint: 'ws://127.0.0.1:8010/'
    },
    headless: false
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

import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  timeout: 5000,
  fullyParallel: true,
  use: {
    connectOptions: {
      wsEndpoint: 'ws://127.0.0.1:8010/'
    }
  },
  projects: [
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
    // {
    //   name: 'chromium',
    //   use: { ...devices['Desktop Chrome'] },
    // },
    // {
    //   name: 'firefox',
    //   use: { ...devices['Desktop Firefox'] },
    // },
  ]
})

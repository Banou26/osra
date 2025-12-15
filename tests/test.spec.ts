import type { BrowserContext } from 'playwright/test'

import path from 'path'
import { fileURLToPath } from 'url'

import { chromium } from 'playwright'
import { test as base } from 'playwright/test'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Path to your built extension
const extensionPath = path.join(__dirname, '../build/extension-test')

export const test = base.extend<{
  context: BrowserContext
  extensionId: string
}>({
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      headless: false,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ],
    })
    await use(context)
    await context.close()
  },
  extensionId: async ({ context }, use) => {
    let [background] = context.serviceWorkers()
    if (!background) {
      background = await context.waitForEvent('serviceworker')
    }
    const extensionId = background.url().split('/')[2]
    await use(extensionId)
  },
})

test('aa', async ({ context, extensionId }) => {
  const page = await context.newPage()
  
  // Create a CDP session
  const client = await page.context().newCDPSession(page);
  console.log('client', !!client)

  // ✅ Enable Runtime FIRST - this must happen before you can receive events
  await client.send('Runtime.enable');

  const contextId = await new Promise<number>((resolve) => {
    client.on('Runtime.executionContextCreated', ({ context }) => {
      console.log('Context created:', context.origin)
      if (context.origin?.startsWith(`chrome-extension://${extensionId}`)) {
        resolve(context.id)
      }
    })
    
    // Navigate after setting up listener
    page.goto('https://www.google.com/chrome/browser/canary.html')
  })
  console.log('contextId', contextId)

  const { result } = await client.send('Runtime.evaluate', {
    expression: 'window',
    contextId
  });
  console.log('result', result)

  await client.send('Runtime.evaluate', {
    expression: 'myContentScriptFunction()',
    contextId
  })

  await new Promise(f => setTimeout(f, 10000))
})

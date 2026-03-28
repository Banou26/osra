import { test, chromium, type BrowserContext, type CDPSession } from '@playwright/test'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'

import tests from './_tests_'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const extensionPath = path.join(__dirname, '../../build/extension-test')

type TestObject = {
  [key: string]: TestObject | (() => any)
}

let context: BrowserContext
let extensionId: string
let cdp: CDPSession
let contextId: number

test.beforeAll(async () => {
  if (!fs.existsSync(path.join(extensionPath, 'manifest.json'))) {
    throw new Error(`Extension not found at ${extensionPath}. Run "npm run build-extension-test" first.`)
  }

  context = await chromium.launchPersistentContext('', {
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  })

  const workers = context.serviceWorkers()
  extensionId = workers.find(w => w.url().startsWith('chrome-extension://'))?.url().split('/')[2] ?? ''

  if (!extensionId) {
    const worker = await context.waitForEvent('serviceworker', { timeout: 10000 })
    extensionId = worker.url().split('/')[2]
  }

  const page = await context.newPage()
  cdp = await page.context().newCDPSession(page)
  await cdp.send('Runtime.enable')

  contextId = await new Promise<number>((resolve) => {
    cdp.on('Runtime.executionContextCreated', ({ context }) => {
      if (context.origin?.startsWith(`chrome-extension://${extensionId}`)) {
        resolve(context.id)
      }
    })
    page.goto('http://localhost:3000')
  })

  // Wait for both Content and RuntimeContent tests to be ready
  await new Promise<void>(async (resolve) => {
    while (true) {
      const { result } = await cdp.send('Runtime.evaluate', {
        expression: 'globalThis.tests?.Content !== undefined && globalThis.tests?.RuntimeContent !== undefined',
        contextId
      })
      if (result.value) {
        resolve()
        break
      }
      await new Promise(r => setTimeout(r, 100))
    }
  })
})

test.afterAll(async () => {
  await context?.close()
})

// Port-based transport tests
test.describe('Content', () => {
  const contentTests = tests.Content as TestObject
  for (const [key, value] of Object.entries(contentTests)) {
    if (typeof value === 'function' && !key.startsWith('set')) {
      test(key, async () => {
        const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', {
          expression: `globalThis.tests.Content.${key}()`,
          contextId,
          awaitPromise: true
        })
        if (exceptionDetails) {
          throw new Error(exceptionDetails.exception?.description || 'Test failed')
        }
      })
    }
  }
})

// Runtime transport tests (sendMessage/onMessage) — same extension, same page
test.describe('Runtime Transport Content', () => {
  const runtimeTests = tests.RuntimeContent as TestObject
  for (const [key, value] of Object.entries(runtimeTests)) {
    if (typeof value === 'function' && !key.startsWith('set')) {
      test(key, async () => {
        const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', {
          expression: `globalThis.tests.RuntimeContent.${key}()`,
          contextId,
          awaitPromise: true
        })
        if (exceptionDetails) {
          throw new Error(exceptionDetails.exception?.description || 'Test failed')
        }
      })
    }
  }
})

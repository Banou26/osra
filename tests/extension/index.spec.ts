import { test, chromium, type BrowserContext, type Page } from '@playwright/test'
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

  // Get extension ID
  const workers = context.serviceWorkers()
  extensionId = workers.find(w => w.url().startsWith('chrome-extension://'))?.url().split('/')[2] ?? ''

  if (!extensionId) {
    const worker = await context.waitForEvent('serviceworker', { timeout: 10000 })
    extensionId = worker.url().split('/')[2]
  }
})

test.afterAll(async () => {
  await context?.close()
})

// Helper to wait for content script to be ready
const waitForContentScript = async (page: Page) => {
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Content script timeout')), 15000)
    window.addEventListener('message', function handler(event) {
      if (event.data?.type === 'OSRA_CONTENT_READY' || event.data?.type === 'OSRA_PONG') {
        clearTimeout(timeout)
        window.removeEventListener('message', handler)
        resolve()
      }
    })
    const ping = setInterval(() => window.postMessage({ type: 'OSRA_PING' }, '*'), 100)
    setTimeout(() => clearInterval(ping), 15000)
  }))
}

// Helper to run a content script test via message passing
const runContentTest = async (page: Page, key: string, path: string[]) => {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`

  const result = await page.evaluate(([key, path, id]) => new Promise<{ success: boolean; error?: string }>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Test execution timeout')), 30000)

    window.addEventListener('message', function handler(event) {
      if (event.data?.type === 'OSRA_TEST_RESULT' && event.data?.id === id) {
        clearTimeout(timeout)
        window.removeEventListener('message', handler)
        resolve({ success: event.data.success, error: event.data.error })
      }
    })

    window.postMessage({ type: 'OSRA_RUN_TEST', key, path, id }, '*')
  }), [key, path, id] as const)

  if (!result.success) {
    throw new Error(result.error || 'Test failed')
  }
}

// Content script tests - use message passing due to isolated world
test.describe('Content', () => {
  let page: Page

  test.beforeAll(async () => {
    page = await context.newPage()
    await page.goto('http://localhost:3000')
    await waitForContentScript(page)
  })

  test.afterAll(async () => {
    await page?.close()
  })

  const contentTests = tests.Content as TestObject
  for (const [key, value] of Object.entries(contentTests)) {
    if (typeof value === 'function' && key !== 'setApi') {
      test(key, async () => {
        await runContentTest(page, key, ['Content'])
      })
    }
  }
})

// Popup tests - can use direct page.evaluate since popup runs in extension page context
test.describe('Popup', () => {
  let popupPage: Page

  test.beforeAll(async () => {
    popupPage = await context.newPage()
    await popupPage.goto(`chrome-extension://${extensionId}/popup.html`)
    // Wait for popup to be ready
    await popupPage.waitForFunction(() => (globalThis as any).tests?.Popup !== undefined, { timeout: 15000 })
  })

  test.afterAll(async () => {
    await popupPage?.close()
  })

  const popupTests = tests.Popup as TestObject
  for (const [key, value] of Object.entries(popupTests)) {
    if (typeof value === 'function' && key !== 'setApi') {
      test(key, async () => {
        await popupPage.evaluate(async ([key]) => {
          const test = (globalThis as any).tests?.Popup?.[key]
          if (typeof test !== 'function') {
            throw new Error(`Test not found: Popup.${key}`)
          }
          await test()
        }, [key] as const)
      })
    }
  }
})

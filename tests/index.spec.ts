import { test } from '@playwright/test'
import fs from 'fs'
import path from 'path'

import tests from './_tests_'

type TestObject = {
  [key: string]: TestObject | (() => any)
}

test.beforeEach(async ({ page }) => {
  await page.goto('http://localhost:3000')
  // Uncomment for better debug experience, the devtools will have full context on the console's object's being logged.
  // await new Promise(resolve => setTimeout(resolve, 250))
  await page.addScriptTag({ path: './build/test.js', type: 'module' })
})

test.afterEach(async ({ page }) => {
  // Collect coverage after each test
  const coverage = await page.evaluate(() => (window as any).__coverage__)
  if (coverage) {
    const coverageDir = path.join(process.cwd(), '.nyc_output')
    if (!fs.existsSync(coverageDir)) {
      fs.mkdirSync(coverageDir, { recursive: true })
    }
    const coverageFile = path.join(coverageDir, `coverage-${Date.now()}-${Math.random().toString(36).slice(2)}.json`)
    fs.writeFileSync(coverageFile, JSON.stringify(coverage))
  }
})

const recurseTests = (tests: TestObject, path: string[] = []) => {
  for (const [key, value] of Object.entries(tests)) {
    if (typeof value === 'function') {
      test(key, async ({ page }) => {
        await page.evaluate(async ([key, path]) => {
          await path.reduce((obj, key) => obj[key], globalThis.tests)[key]()
        }, [key, path] as const)
      })
    } else if (typeof value === 'object') {
      test.describe(key, () => {
        recurseTests(value, [...path, key])
      })
    }
  }
}
recurseTests(tests)

import { test } from '@playwright/test'
import fs from 'fs'
import path from 'path'

import tests from './_tests_'

type TestObject = {
  [key: string]: TestObject | (() => any)
}

test.beforeEach(async ({ page }) => {
  // page.on('console', async msg => {
  //   const args = msg.args()
  //   const logValues =
  //     await Promise.all(
  //       args.map(arg =>
  //         arg.evaluate(obj => {
  //           try {
  //             return JSON.stringify(
  //               obj,
  //               (key, value) =>
  //                 typeof value === 'function'
  //                   ? `[Function: ${value.name || 'anonymous'}]`
  //                   : value
  //             )
  //           } catch (err) {
  //             return `[Error: ${(err as Error).message}]`
  //           }
  //         })
  //       )
  //     )
  //   console.log(...logValues)
  // })
  // page.on('pageerror', err => console.log(err))
  await page.goto('http://localhost:3000')
  await new Promise(resolve => setTimeout(resolve, 250))
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

import { test } from '@playwright/test'

import tests from './_tests_'

type TestObject = {
  [key: string]: TestObject | (() => any)
}

test.beforeEach(async ({ page }) => {
  page.on('console', async msg => {
    const args = msg.args()
    const logValues =
      await Promise.all(
        args.map(arg =>
          arg.evaluate(obj => {
            return JSON.stringify(
              obj,
              (key, value) =>
                typeof value === 'function'
                  ? `[Function: ${value.name || 'anonymous'}]`
                  : value
            )
          })
        )
      )
    console.log(...logValues)
  })
  page.on('pageerror', err => console.log(err))
  await page.goto('http://localhost:3000')
  await page.addScriptTag({ path: './build/test.js', type: 'module' })
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

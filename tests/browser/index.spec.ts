import type { TestConfig, TestObject } from '../global-types'

import { test } from '@playwright/test'
import path from 'path'

import tests from './_tests_'
import { mkdir, writeFile } from 'fs/promises'

test.beforeEach(async ({ page }) => {
  await page.goto('http://localhost:3000')
  // Uncomment for better debug experience, the devtools will have full context on the console's object's being logged.
  await new Promise(resolve => setTimeout(resolve, 250))
  await page.addScriptTag({ path: './build/test.js', type: 'module' })
})

test.afterEach(async ({ page }) => {
  // Collect coverage after each test
  const coverage = await page.evaluate(() => (window as any).__coverage__)
  if (coverage) {
    const coverageDir = path.join(process.cwd(), '.nyc_output')
    await mkdir(coverageDir, { recursive: true }).catch(() => {})
    const coverageFilePath = path.join(coverageDir, `coverage-${Date.now()}-${Math.random().toString(36).slice(2)}.json`)
    await writeFile(coverageFilePath, JSON.stringify(coverage))
  }
})

const recurseTests = (tests: TestObject, path: string[] = []) => {
  for (const [key, value] of Object.entries(tests)) {
    if (typeof value === 'function') {
      test(key, async ({ page }) => {
        const config =
          path
            .reduce<TestObject | undefined>(
              (obj, key) => obj?.[key] as TestObject | undefined,
              globalThis.tests
            )
            ?.config
        if (config?.timeout) {
          test.setTimeout(config.timeout)
        }
        const client = await page.context().newCDPSession(page)
        if (config?.memoryTreshold) {
          await client.send('Performance.enable')
          await client.send('HeapProfiler.collectGarbage')
        }
        const initialHeap =
          config?.memoryTreshold
          ? (
            (await client.send('Performance.getMetrics'))
              .metrics
              .find(m => m.name === 'JSHeapUsedSize')
              ?.value
          )
          : undefined
        if (config?.memoryTreshold && initialHeap === undefined) {
          throw new Error('Memory threshold is set but initial heap size is not available')
        }
        await page.evaluate(async ([key, path]) => {
          const findTest = () =>
            path
              .reduce<TestObject | undefined>(
                (obj, key) => obj?.[key] as TestObject | undefined,
                globalThis.tests
              )
              ?.[key]
          let test = findTest()
          while (typeof test !== 'function') {
            await new Promise(resolve => setTimeout(resolve, 100))
            test = findTest()
          }
          await test()
        }, [key, path] as const)
        if (initialHeap) {
          for (let i = 0; i < 10; i++) {
            await client.send('HeapProfiler.collectGarbage')
            // Allow FinalizationRegistry callbacks to run after GC
            await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 100)))
            // Run GC again to collect any objects freed by finalization callbacks
            await client.send('HeapProfiler.collectGarbage')
          }
          const finalMetrics = await client.send('Performance.getMetrics')
          const finalHeap = finalMetrics.metrics.find(m => m.name === 'JSHeapUsedSize')?.value ?? 0
          const memoryGrowth = finalHeap - initialHeap
          if (config?.memoryTreshold && memoryGrowth > config.memoryTreshold) {
            throw new Error(`Memory leak detected: ${memoryGrowth} bytes growth`)
          }
        }
      })
    } else if (typeof value === 'object' && key !== 'config') {
      test.describe(key, () => {
        recurseTests(value as TestObject, [...path, key])
      })
    }
  }
}
recurseTests(tests)

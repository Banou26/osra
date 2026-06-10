import type { Page } from '@playwright/test'

import { test } from '@playwright/test'
import path from 'path'
import { fileURLToPath } from 'url'
import { mkdir, writeFile } from 'fs/promises'

import { transportTests, memoryTests, standaloneTests, gcTests } from './registry'
import { transports } from './transports'

// Heaviest memory test (concurrentCallsNoLeak) lands around 50s on a
// quiet machine and pushes higher under parallel CPU contention. Give
// the group enough headroom that the timeout fires on real hangs, not
// on scheduling jitter from sibling tests.
const MEMORY_TEST_TIMEOUT_MS = 120_000
const GC_TEST_TIMEOUT_MS = 30_000

// Resolve the test bundle's absolute path from this file's location so
// page.addScriptTag works regardless of which cwd the per-browser
// Playwright worker is launched from (WebKit's worker resolves relative
// paths from a different directory and fails ENOENT on './build/...').
const TEST_BUNDLE_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'build-test',
  'test.js',
)

test.beforeEach(async ({ page }) => {
  await page.goto('http://localhost:3000')
  await page.addScriptTag({ path: TEST_BUNDLE_PATH, type: 'module' })
  // The bundle exposes globalThis.__osraRun once side-effect imports settle.
  await page.waitForFunction(() => '__osraRun' in globalThis)
})

test.afterEach(async ({ page }) => {
  const coverage = await page.evaluate(() => (window as unknown as { __coverage__?: unknown }).__coverage__)
  if (!coverage) return
  const dir = path.join(process.cwd(), '.nyc_output')
  await mkdir(dir, { recursive: true }).catch(() => {})
  await writeFile(
    path.join(dir, `coverage-${Date.now()}-${Math.random().toString(36).slice(2)}.json`),
    JSON.stringify(coverage),
  )
})

// Heap measurement bracket — call before the test body, await the returned
// finalizer afterwards. Iterates GC + a microtask break so FinalizationRegistry
// callbacks fire before the final measurement.
const measureHeapGrowth = async (page: Page, threshold: number) => {
  const client = await page.context().newCDPSession(page)
  await client.send('Performance.enable')
  await client.send('HeapProfiler.collectGarbage')
  const initial = (await client.send('Performance.getMetrics')).metrics
    .find(m => m.name === 'JSHeapUsedSize')?.value
  if (initial === undefined) throw new Error('Initial heap size unavailable')

  return async () => {
    for (let i = 0; i < 10; i++) {
      await client.send('HeapProfiler.collectGarbage')
      await page.evaluate(() => new Promise(r => setTimeout(r, 100)))
      await client.send('HeapProfiler.collectGarbage')
    }
    const finalHeap = (await client.send('Performance.getMetrics')).metrics
      .find(m => m.name === 'JSHeapUsedSize')?.value ?? 0
    const growth = finalHeap - initial
    if (growth > threshold) throw new Error(`Memory leak detected: ${growth} bytes growth`)
  }
}

// Transport-parameterized matrix: every test in transportTests runs once per
// registered transport. Adding a new transport in transports.ts grows the
// matrix automatically; adding a new test in any registered module the same.
for (const t of transports) {
  test.describe(t.name, () => {
    for (const [group, suite] of Object.entries(transportTests)) {
      test.describe(group, () => {
        for (const name of Object.keys(suite)) {
          test(name, async ({ page }) => {
            await page.evaluate(
              async ([g, n, tn]) => globalThis.__osraRun.transport(g, n, tn as never),
              [group, name, t.name] as const,
            )
          })
        }
      })
    }

    // measureHeapGrowth uses CDP's Performance.getMetrics +
    // HeapProfiler.collectGarbage to take deterministic heap snapshots.
    // Both are Chromium-only; skip on other browsers.
    test.describe('MemoryLeaks', () => {
      test.skip(({ browserName }) => browserName !== 'chromium', 'CDP required')
      for (const name of Object.keys(memoryTests)) {
        test(name, async ({ page }) => {
          test.setTimeout(MEMORY_TEST_TIMEOUT_MS)
          const finalize = await measureHeapGrowth(page, t.memoryThreshold)
          await page.evaluate(
            async ([n, tn]) => globalThis.__osraRun.memory(n, tn as never),
            [name, t.name] as const,
          )
          await finalize()
        })
      }
    })

    // page.requestGC() triggers GC across Chromium, Firefox, and WebKit
    // (added in Playwright 1.48 via PR microsoft/playwright#32383). We
    // still need to drain macrotasks between collections so
    // FinalizationRegistry callbacks (queued as jobs, not sync) actually
    // fire. The macrotask sleep is what makes the WeakRef-based assertions
    // observe the post-GC state.
    test.describe('GcTests', () => {
      for (const name of Object.keys(gcTests)) {
        test(name, async ({ page }) => {
          test.setTimeout(GC_TEST_TIMEOUT_MS)
          await page.exposeFunction('__osraForceGc', async () => {
            for (let i = 0; i < 10; i++) {
              await page.requestGC()
              await page.evaluate(() => new Promise(r => setTimeout(r, 50)))
            }
          })
          await page.evaluate(
            async ([n, tn]) => globalThis.__osraRun.gc(n, tn as never),
            [name, t.name] as const,
          )
        })
      }
    })
  })
}

// Standalone groups: not transport-parameterized.
for (const [group, suite] of Object.entries(standaloneTests)) {
  test.describe(group, () => {
    for (const name of Object.keys(suite)) {
      test(name, async ({ page }) => {
        await page.evaluate(
          async ([g, n]) => globalThis.__osraRun.standalone(g, n),
          [group, name] as const,
        )
      })
    }
  })
}

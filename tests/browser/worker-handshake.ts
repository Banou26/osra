import { expect } from 'chai'

import { expose } from '../../src/index'

// The worker imports osra from the published build (/build/index.js)
// and calls expose() inside the dynamic import resolution. A
// synchronous busy-wait at the top of the module body blocks the event
// loop and delays both the import and the expose() — that is, no
// 'message' listener exists in the worker scope for `delayMs`. Firefox
// silently drops messages posted to a worker during that window;
// Chrome and WebKit buffer them. This mirrors libav-wasm's real shape:
// static imports and setup come first, the listener is attached only
// when expose() runs.
const buildWorkerSource = (osraUrl: string, delayMs: number) => `
  const __deadline = performance.now() + ${delayMs}
  while (performance.now() < __deadline) {}
  import('${osraUrl}').then(({ expose }) => {
    expose(
      { ping: async (n) => n + 1 },
      { transport: globalThis },
    )
  })
`

const osraUrl = () => new URL('/build/index.js', location.href).href

type Remote = { ping: (n: number) => Promise<number> }

// Healthy worker handshake completes in well under 100ms in Chrome and
// Firefox. A 1s deadline catches hangs without dragging out CI when the
// suite happens to be misconfigured.
const HANDSHAKE_DEADLINE_MS = 1_000

const makeWorker = (url: string) =>
  new Worker(url, { type: 'module' })

const awaitHandshake = async (worker: Worker) => {
  const handshake = expose<Remote>({}, { transport: worker })
  const outcome = await Promise.race([
    handshake.then(remote => ({ ok: true as const, remote })),
    new Promise<{ ok: false }>(r =>
      setTimeout(() => r({ ok: false }), HANDSHAKE_DEADLINE_MS),
    ),
  ])
  return outcome
}

// Single fresh module worker. With the FF race fixed, the handshake
// must complete in well under the deadline and the remote must be usable.
export const moduleWorkerHandshake = async () => {
  const url = URL.createObjectURL(
    new Blob([buildWorkerSource(osraUrl(), 100)], { type: 'application/javascript' }),
  )
  const worker = makeWorker(url)
  try {
    const outcome = await awaitHandshake(worker)
    expect(outcome.ok, 'handshake completed within deadline').to.be.true
    if (!outcome.ok) return
    expect(await outcome.remote.ping(41)).to.equal(42)
  } finally {
    worker.terminate()
    URL.revokeObjectURL(url)
  }
}

// Stress: open module workers back-to-back. Per the brief, the race
// is intermittent — one round may slip through. N sequential rounds
// give Firefox plenty of opportunities to drop the first announce.
export const moduleWorkerHandshakeStress = async () => {
  const url = URL.createObjectURL(
    new Blob([buildWorkerSource(osraUrl(), 100)], { type: 'application/javascript' }),
  )
  try {
    for (let i = 0; i < 10; i++) {
      const worker = makeWorker(url)
      const outcome = await awaitHandshake(worker)
      expect(outcome.ok, `iteration ${i}: handshake completed`).to.be.true
      if (outcome.ok) {
        expect(await outcome.remote.ping(i)).to.equal(i + 1)
      }
      worker.terminate()
    }
  } finally {
    URL.revokeObjectURL(url)
  }
}

// Parallel: spawn many workers concurrently and wait for every
// handshake. Concurrent spawns hit the same race once per worker.
export const moduleWorkerHandshakeParallel = async () => {
  const url = URL.createObjectURL(
    new Blob([buildWorkerSource(osraUrl(), 100)], { type: 'application/javascript' }),
  )
  const workers: Worker[] = []
  try {
    const handshakes: Promise<{ ok: boolean }>[] = []
    for (let i = 0; i < 10; i++) {
      const worker = makeWorker(url)
      workers.push(worker)
      handshakes.push(awaitHandshake(worker))
    }
    const outcomes = await Promise.all(handshakes)
    for (let i = 0; i < outcomes.length; i++) {
      expect(outcomes[i]!.ok, `worker ${i}: handshake completed`).to.be.true
    }
  } finally {
    for (const w of workers) w.terminate()
    URL.revokeObjectURL(url)
  }
}


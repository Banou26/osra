import { expect } from 'chai'

import { expose } from '../../src/index'

// Firefox silently drops messages posted to a worker with no 'message' listener yet; the busy-wait holds that window open.
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


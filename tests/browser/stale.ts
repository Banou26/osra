import type { Transport } from '../../src'
import type { Message } from '../../src/types'
import type { MessageContext } from '../../src/utils/transport'

import { expect } from 'chai'

import { expose, isStale, onStale } from '../../src/index'

// Race a promise against a timeout. Used to assert "X happens within N ms"
// without depending on real wall clocks beyond a coarse upper bound.
const withTimeout = <T>(p: Promise<T>, ms: number, label: string): Promise<T | 'timeout'> =>
  Promise.race([
    p,
    new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), ms)).then((v) => {
      if (v === 'timeout') throw new Error(`Timeout (${ms}ms): ${label}`)
      return v
    }),
  ])

// Resolves to true if `p` settles within `ms`, false if it doesn't.
const settlesWithin = <T>(p: Promise<T>, ms: number): Promise<boolean> =>
  Promise.race([
    p.then(() => true, () => true),
    new Promise<boolean>((r) => setTimeout(() => r(false), ms)),
  ])

// ---- Transport-parameterized ----

export const functionStaleAfterPeerClose = async (transport: Transport) => {
  const controller = new AbortController()
  expose({ fn: async () => 42 }, { transport, unregisterSignal: controller.signal })
  const remote = await expose<{ fn: () => Promise<number> }>({}, { transport })

  expect(isStale(remote.fn)).to.equal(false)
  const stalePromise = onStale(remote.fn)

  controller.abort()
  await new Promise((r) => setTimeout(r, 50))

  expect(await settlesWithin(stalePromise, 500)).to.equal(true)
  expect(isStale(remote.fn)).to.equal(true)
}

export const promiseStaleAfterSettlement = async (transport: Transport) => {
  const value = { p: Promise.resolve('hi') }
  expose(value, { transport })
  const remote = await expose<typeof value>({}, { transport })

  const stalePromise = onStale(remote.p)
  await expect(remote.p).to.eventually.equal('hi')
  await new Promise((r) => queueMicrotask(() => r(undefined)))
  expect(isStale(remote.p)).to.equal(true)
  expect(await settlesWithin(stalePromise, 200)).to.equal(true)
}

export const streamStaleAfterCancel = async (transport: Transport) => {
  const stream = new ReadableStream<number>({
    start: (c) => { c.enqueue(1); c.enqueue(2); c.enqueue(3); c.close() },
  })
  expose({ s: stream }, { transport })
  const remote = await expose<{ s: ReadableStream<number> }>({}, { transport })

  const reader = remote.s.getReader()
  await reader.read()
  reader.releaseLock()
  await remote.s.cancel()
  await new Promise((r) => queueMicrotask(() => r(undefined)))
  await new Promise((r) => setTimeout(r, 20))
  expect(isStale(remote.s)).to.equal(true)
}

export const connectionStaleCascadesToAllRevivables = async (transport: Transport) => {
  const controller = new AbortController()
  expose(
    { fn: async () => 1, p: Promise.resolve(2), s: new ReadableStream() },
    { transport, unregisterSignal: controller.signal },
  )
  type Api = { fn: () => Promise<number>, p: Promise<number>, s: ReadableStream }
  const remote = await expose<Api>({}, { transport })

  expect(isStale(remote.fn)).to.equal(false)
  expect(isStale(remote.s)).to.equal(false)

  const sFn = onStale(remote.fn)
  const sP = onStale(remote.p)
  const sS = onStale(remote.s)

  controller.abort()

  expect(await settlesWithin(sFn, 500)).to.equal(true)
  expect(await settlesWithin(sP, 500)).to.equal(true)
  expect(await settlesWithin(sS, 500)).to.equal(true)
  expect(isStale(remote.fn)).to.equal(true)
  expect(isStale(remote.s)).to.equal(true)
}

export const isStaleReturnsFalseForUntracked = async (_transport: Transport) => {
  expect(isStale(42)).to.equal(false)
  expect(isStale('hello')).to.equal(false)
  expect(isStale(null)).to.equal(false)
  expect(isStale(undefined)).to.equal(false)
  expect(isStale({ plain: 'object' })).to.equal(false)

  expect(await settlesWithin(onStale(42), 100)).to.equal(false)
  expect(await settlesWithin(onStale(undefined), 100)).to.equal(false)
  expect(await settlesWithin(onStale({ x: 1 }), 100)).to.equal(false)
}

export const onStaleResolvesOncePerValue = async (transport: Transport) => {
  const controller = new AbortController()
  expose({ fn: async () => 1 }, { transport, unregisterSignal: controller.signal })
  const remote = await expose<{ fn: () => Promise<number> }>({}, { transport })

  const promises = Array.from({ length: 10 }, () => onStale(remote.fn))
  controller.abort()
  const settled = await Promise.all(promises.map((p) => settlesWithin(p, 500)))
  expect(settled.every((s) => s === true)).to.equal(true)
}

export const eagerlyAbortedAbortSignalIsStaleImmediately = async (transport: Transport) => {
  const eager = AbortSignal.abort('eager-reason')
  expose({ s: eager }, { transport })
  const remote = await expose<{ s: AbortSignal }>({}, { transport })

  expect(remote.s.aborted).to.equal(true)
  expect(isStale(remote.s)).to.equal(true)
  expect(await settlesWithin(onStale(remote.s), 50)).to.equal(true)
}

export const staleConnectionRejectsNewCalls = async (transport: Transport) => {
  const controller = new AbortController()
  expose({ fn: async () => 1 }, { transport, unregisterSignal: controller.signal })
  const remote = await expose<{ fn: () => Promise<number> }>({}, { transport })

  controller.abort()
  await onStale(remote.fn)

  await expect(withTimeout(remote.fn(), 500, 'rejected stale call')).to.be.rejectedWith(/stale/)
}

export const staleConnectionRejectsInFlightCall = async (transport: Transport) => {
  const controller = new AbortController()
  expose({ slow: () => new Promise<number>(() => {}) }, { transport, unregisterSignal: controller.signal })
  const remote = await expose<{ slow: () => Promise<number> }>({}, { transport })

  const inFlight = remote.slow()
  // Let the call message dispatch
  await new Promise((r) => setTimeout(r, 50))
  controller.abort()

  await expect(withTimeout(inFlight, 500, 'in-flight stale rejection')).to.be.rejectedWith(/stale/)
}

export const responseAndBodyBothStale = async (transport: Transport) => {
  const controller = new AbortController()
  const body = new ReadableStream<Uint8Array>({
    start: (c) => { c.enqueue(new Uint8Array([1, 2, 3])); c.close() },
  })
  const r = new Response(body, { status: 200 })
  expose({ r }, { transport, unregisterSignal: controller.signal })
  const remote = await expose<{ r: Response }>({}, { transport })

  expect(isStale(remote.r)).to.equal(false)
  expect(remote.r.body).to.not.equal(null)
  if (remote.r.body) expect(isStale(remote.r.body)).to.equal(false)

  const sR = onStale(remote.r)
  controller.abort()

  expect(await settlesWithin(sR, 500)).to.equal(true)
  expect(isStale(remote.r)).to.equal(true)
  if (remote.r.body) expect(isStale(remote.r.body)).to.equal(true)
}

export const eventTargetStaleAfterConnectionStale = async (transport: Transport) => {
  const controller = new AbortController()
  expose({ et: new EventTarget() }, { transport, unregisterSignal: controller.signal })
  const remote = await expose<{ et: EventTarget }>({}, { transport })

  expect(isStale(remote.et)).to.equal(false)
  const sEt = onStale(remote.et)
  controller.abort()
  expect(await settlesWithin(sEt, 500)).to.equal(true)
  expect(isStale(remote.et)).to.equal(true)
}

// ---- Standalone (not transport-parameterized) ----

export const heartbeatTimeoutMarksStale = async () => {
  const { port1, port2 } = new MessageChannel()
  port1.start()
  port2.start()

  let dropPongs = false
  const sideBTransport: Transport = {
    isJson: true,
    receive: (cb: (m: Message, ctx: MessageContext) => void) => {
      port2.addEventListener('message', (e) => cb(JSON.parse((e as MessageEvent).data as string) as Message, {}))
    },
    emit: (m: Message) => {
      if (dropPongs && (m as { type: string }).type === 'pong') return
      port2.postMessage(JSON.stringify(m))
    },
  }
  const sideATransport: Transport = {
    isJson: true,
    receive: (cb: (m: Message, ctx: MessageContext) => void) => {
      port1.addEventListener('message', (e) => cb(JSON.parse((e as MessageEvent).data as string) as Message, {}))
    },
    emit: (m: Message) => port1.postMessage(JSON.stringify(m)),
  }

  expose({ fn: async () => 1 }, { transport: sideBTransport })
  const remote = await expose<{ fn: () => Promise<number> }>(
    {},
    { transport: sideATransport, heartbeat: { intervalMs: 50, timeoutMs: 150 } },
  )

  expect(await remote.fn()).to.equal(1)
  dropPongs = true

  expect(await settlesWithin(onStale(remote.fn), 1000)).to.equal(true)
  expect(isStale(remote.fn)).to.equal(true)
}

export const heartbeatDoesNotFireDuringSlowHandshake = async () => {
  const { port1, port2 } = new MessageChannel()
  port1.start()
  port2.start()

  let allowSideAOutbound = false
  const buffered: string[] = []
  const sideATransport: Transport = {
    isJson: true,
    receive: (cb: (m: Message, ctx: MessageContext) => void) => {
      port1.addEventListener('message', (e) => cb(JSON.parse((e as MessageEvent).data as string) as Message, {}))
    },
    emit: (m: Message) => {
      const json = JSON.stringify(m)
      if (allowSideAOutbound) port1.postMessage(json)
      else buffered.push(json)
    },
  }
  const sideBTransport: Transport = {
    isJson: true,
    receive: (cb: (m: Message, ctx: MessageContext) => void) => {
      port2.addEventListener('message', (e) => cb(JSON.parse((e as MessageEvent).data as string) as Message, {}))
    },
    emit: (m: Message) => port2.postMessage(JSON.stringify(m)),
  }

  expose({ fn: async () => 1 }, { transport: sideBTransport })
  const remotePromise = expose<{ fn: () => Promise<number> }>(
    {},
    { transport: sideATransport, heartbeat: { intervalMs: 30, timeoutMs: 60 } },
  )

  // Hold A's outbound longer than the heartbeat timeout — if pings were
  // ticking pre-handshake, we'd false-positive here.
  await new Promise((r) => setTimeout(r, 200))
  allowSideAOutbound = true
  for (const b of buffered) port1.postMessage(b)
  buffered.length = 0

  const remote = await remotePromise
  // Connection is alive — heartbeat didn't false-positive during the delay.
  expect(isStale(remote.fn)).to.equal(false)
  expect(await remote.fn()).to.equal(1)
}

export const exposeRejectsOnPreHandshakeTransportDeath = async () => {
  const { port1 } = new MessageChannel()
  port1.start()
  // Peer never connects — port2 is discarded.
  const controller = new AbortController()

  const p = expose<{ fn: () => Promise<number> }>(
    {},
    { transport: port1, unregisterSignal: controller.signal },
  )

  setTimeout(() => controller.abort(), 50)
  await expect(p).to.be.rejectedWith(/stale before handshake/)
}

export const presetRemoteUuidConnectionHasNoStaleSourceWithoutSignal = async () => {
  const { port1 } = new MessageChannel()
  port1.start()
  const presetUuid = '11111111-1111-1111-1111-111111111111' as const
  const localUuid = '22222222-2222-2222-2222-222222222222' as const

  const p = expose<{ fn: () => Promise<number> }>(
    {},
    {
      transport: port1,
      uuid: localUuid,
      remoteUuid: presetUuid,
      heartbeat: { intervalMs: 50, timeoutMs: 100 },
    },
  )

  expect(await settlesWithin(p, 300)).to.equal(false)
}

// ---- Test groups ----

export const stale = {
  functionStaleAfterPeerClose,
  promiseStaleAfterSettlement,
  streamStaleAfterCancel,
  connectionStaleCascadesToAllRevivables,
  isStaleReturnsFalseForUntracked,
  onStaleResolvesOncePerValue,
  eagerlyAbortedAbortSignalIsStaleImmediately,
  staleConnectionRejectsNewCalls,
  staleConnectionRejectsInFlightCall,
  responseAndBodyBothStale,
  eventTargetStaleAfterConnectionStale,
}

export const staleStandalone = {
  heartbeatTimeoutMarksStale,
  heartbeatDoesNotFireDuringSlowHandshake,
  exposeRejectsOnPreHandshakeTransportDeath,
  presetRemoteUuidConnectionHasNoStaleSourceWithoutSignal,
}

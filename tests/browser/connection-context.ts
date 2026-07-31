import { expect } from 'chai'

import { expose, context } from '../../src/index'

// The per-connection surface: a context built from local knowledge, iteration over every peer, and
// a per-connection abort. Every case here stands for a defect that shipped once and must not again.

const newPair = () => new MessageChannel()

export const contextBuilderScopesTheValue = async () => {
  const { port1, port2 } = newPair()
  expose(
    context(
      ctx => ({ who: async () => `${ctx.appId}` }),
      () => ({ appId: 'scoped' }),
    ),
    { transport: port1 },
  )
  const { value: remote } = await expose<{ who: () => Promise<string> }>({}, { transport: port2 })
  await expect(remote.who()).to.eventually.equal('scoped')
}

// A function VALUE must stay a plain exposed endpoint. Detecting a factory by `typeof` would have
// swallowed it, which is why the marker exists.
export const bareFunctionValueIsStillAnEndpoint = async () => {
  const { port1, port2 } = newPair()
  const value = async (n: number) => n * 2
  expose(value, { transport: port1 })
  const { value: remote } = await expose<typeof value>({}, { transport: port2 })
  await expect(remote(21)).to.eventually.equal(42)
}

// A port observes no origin, so a declared value is all there is; it must survive the merge rather
// than being clobbered by an empty observation.
export const declaredContextSurvivesOnAPortTransport = async () => {
  const { port1, port2 } = newPair()
  let seenOrigin: unknown = 'unset'
  expose(
    context(
      ctx => { seenOrigin = ctx.origin; return { ping: async () => 'pong' } },
      () => ({ appId: 'from-declaration' }),
    ),
    { transport: port1 },
  )
  const { value: remote } = await expose<{ ping: () => Promise<string> }>({}, { transport: port2 })
  await expect(remote.ping()).to.eventually.equal('pong')
  expect(seenOrigin, 'a MessagePort observes no origin').to.equal(undefined)
}

export const iterationYieldsTheConnection = async () => {
  const { port1, port2 } = newPair()
  const connections = expose(
    context(() => ({ ping: async () => 'pong' }), () => ({ appId: 'iterated' })),
    { transport: port1 },
  )
  const seen: Record<string, unknown>[] = []
  const collecting = (async () => {
    for await (const connection of connections) {
      seen.push(connection)
      break
    }
  })()
  await expose({}, { transport: port2 })
  await collecting
  expect(seen).to.have.lengthOf(1)
  expect(seen[0]!.appId).to.equal('iterated')
  expect(typeof seen[0]!.abort).to.equal('function')
}

export const abortClosesOnlyThatConnection = async () => {
  const { port1, port2 } = newPair()
  let abortIt: (() => void) | undefined
  expose(
    context(ctx => { abortIt = ctx.abort; return { ping: async () => 'pong' } }),
    { transport: port1 },
  )
  const { value: remote } = await expose<{ ping: () => Promise<string> }>({}, { transport: port2 })
  await expect(remote.ping()).to.eventually.equal('pong')
  expect(abortIt, 'abort is on the context').to.be.a('function')
  abortIt!()
  await expect(remote.ping()).to.eventually.be.rejected
}

// Calling abort from inside the factory used to be a silent no-op AND the value had already been
// sent, so the obvious deny pattern handed the peer a working connection.
export const abortInsideTheFactoryRefusesTheConnection = async () => {
  const { port1, port2 } = newPair()
  expose(
    context(ctx => { ctx.abort?.(); return { ping: async () => 'pong' } }),
    { transport: port1 },
  )
  const { value: remote } = await expose<{ ping: () => Promise<string> }>({}, { transport: port2 })
  await expect(remote.ping()).to.eventually.be.rejected
}

// KNOWN GAP, deliberately not asserted here: when the factory throws, the value is refused locally
// and a close is sent, but the peer may not have registered this side yet, so its close handler drops
// the message at the untracked-peer guard and its own expose() waits forever. Fixing that needs the
// handshake to carry a refusal the peer can act on before registration. Do not add a test asserting
// client-side rejection until that lands; it will hang rather than fail.

// Aborting the whole expose has to end iteration; leaving the queue open hung the loop forever.
export const unregisterAbortEndsIteration = async () => {
  const { port1, port2 } = newPair()
  const controller = new AbortController()
  const connections = expose({}, { transport: port1, unregisterSignal: controller.signal })
  expose({}, { transport: port2 })
  let ended = false
  const looping = (async () => {
    for await (const _ of connections) { /* drain */ }
    ended = true
  })()
  controller.abort()
  await Promise.race([looping, new Promise(resolve => setTimeout(resolve, 2_000))])
  expect(ended, 'iteration terminated after the signal aborted').to.equal(true)
}

// An abandoned iterator used to leave its resolver in the shared queue, so the next connection was
// handed to a dead iterator and neither delivered nor buffered.
export const abandonedIteratorDoesNotSwallowAConnection = async () => {
  const { port1, port2 } = newPair()
  const connections = expose({}, { transport: port1 })
  const iterator = connections[Symbol.asyncIterator]()
  const firstNext = iterator.next()
  await iterator.return?.()
  await expose({}, { transport: port2 })
  const delivered = await Promise.race([
    (async () => { for await (const c of connections) return c })(),
    new Promise(resolve => setTimeout(() => resolve('lost'), 2_000)),
  ])
  expect(delivered, 'a later iterator still receives the connection').to.not.equal('lost')
  await firstNext.catch(() => {})
}

// An invalid transport used to throw synchronously once expose stopped being async, blowing past
// every .catch a consumer had written.
export const invalidTransportRejectsRatherThanThrows = async () => {
  const emitOnly = { emit: (() => {}) as never }
  let threw = false
  let rejected = false
  try {
    await expose({}, { transport: emitOnly as never }).catch(() => { rejected = true })
  } catch {
    threw = true
  }
  expect(threw, 'expose did not throw synchronously').to.equal(false)
  expect(rejected, 'expose rejected instead').to.equal(true)
}

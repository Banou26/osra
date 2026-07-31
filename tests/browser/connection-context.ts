import { expect } from 'chai'

import type { Connected } from '../../src/index'

import { expose, context } from '../../src/index'

// The per-connection surface: a context built from local knowledge, iteration over every peer, and
// a per-connection abort. Every case here stands for a defect that shipped once and must not again.

const newPair = () => new MessageChannel()

// The factory runs once per connection and what it returns is what that peer receives, which is how
// one server answers each realm differently instead of sharing one object across all of them.
export const theFactoryBuildsTheValuePerConnection = async () => {
  const { port1, port2 } = newPair()
  let built = 0
  expose(
    context(ctx => ({ who: async () => `peer-${built}-abort-${typeof ctx.abort}` })),
    { transport: port1 },
  )
  built += 1
  const remote = await expose<{ who: () => Promise<string> }>({}, { transport: port2 })
  await expect(remote.who()).to.eventually.equal('peer-1-abort-function')
}

// A function VALUE must stay a plain exposed endpoint. Detecting a factory by `typeof` would have
// swallowed it, which is why the marker exists.
export const bareFunctionValueIsStillAnEndpoint = async () => {
  const { port1, port2 } = newPair()
  const value = async (n: number) => n * 2
  expose(value, { transport: port1 })
  const remote = await expose<typeof value>({}, { transport: port2 })
  await expect(remote(21)).to.eventually.equal(42)
}

// A MessagePort message carries origin '' and source null, so neither survives into the context.
// Measured, not assumed: it is why a port-based server takes its peer's identity from the lexical
// scope that created the port rather than from anything the connection can tell it.
export const aPortObservesNothingButAbort = async () => {
  const { port1, port2 } = newPair()
  let seen: Record<string, unknown> | undefined
  expose(
    context(ctx => { seen = { ...ctx }; return { ping: async () => 'pong' } }),
    { transport: port1 },
  )
  const remote = await expose<{ ping: () => Promise<string> }>({}, { transport: port2 })
  await expect(remote.ping()).to.eventually.equal('pong')
  expect(Object.keys(seen ?? {}), 'a MessagePort observes no origin or source').to.deep.equal(['abort'])
}

export const iterationYieldsTheConnection = async () => {
  const { port1, port2 } = newPair()
  const exposed = expose(
    context(() => ({ ping: async () => 'pong' })),
    { transport: port1, connection: ({ context: ctx }) => ctx },
  )
  const seen: Record<string, unknown>[] = []
  const collecting = (async () => {
    for await (const connection of exposed) {
      seen.push(connection)
      break
    }
  })()
  await expose({}, { transport: port2 })
  await collecting
  expect(seen).to.have.lengthOf(1)
  expect(typeof seen[0]!.abort, 'iteration yields the selected shape').to.equal('function')
}

// No selector: the result is the peer's value, exactly what expose resolved to before any of this.
// With one: whatever it returns, for the await and for iteration alike.
export const theSelectorDecidesWhatAConnectionIs = async () => {
  const { port1, port2 } = newPair()
  const api = { ping: async () => 'pong' }
  expose(api, { transport: port1 })
  expose(api, { transport: port1, key: 'paired' })

  const bare = await expose<typeof api>({}, { transport: port2 })
  await expect(bare.ping(), 'no selector gives the remote itself').to.eventually.equal('pong')

  // No explicit type argument here, deliberately: TypeScript has no partial type-argument inference,
  // so supplying one makes every later parameter fall back to its default and the selector's return
  // type stops being inferred. Type the remote on the selector's parameter instead.
  const { value, context: ctx } = await expose({}, {
    transport: port2,
    key: 'paired',
    connection: ({ value, context }: Connected<typeof api>) => ({ value, context }),
  })
  await expect(value.ping()).to.eventually.equal('pong')
  expect(typeof ctx.abort, 'the context carries this peer\'s abort').to.equal('function')
}

// The selector can return anything, not just a wrapper: it decides what a connection MEANS here.
export const theSelectorCanReturnAnything = async () => {
  const { port1, port2 } = newPair()
  expose({ ping: async () => 'pong' }, { transport: port1 })
  const canDrop = await expose({}, {
    transport: port2,
    connection: ({ context }) => typeof context.abort === 'function',
  })
  expect(canDrop, 'a connection can be just the one thing this caller cares about').to.equal(true)
}

// Several loops over one expose each mean "tell me about every peer". A shared cursor would let
// whichever one happened to be waiting eat the peer the other was waiting for.
export const everyLoopSeesEveryPeer = async () => {
  const { port1, port2 } = newPair()
  const api = { ping: async () => 'pong' }
  const exposed = expose<typeof api>({}, { transport: port1 })
  const first: unknown[] = []
  const second: unknown[] = []
  const collecting = Promise.all([
    (async () => { for await (const v of exposed) { first.push(v); break } })(),
    (async () => { for await (const v of exposed) { second.push(v); break } })(),
  ])
  expose(api, { transport: port2 })
  await Promise.race([collecting, new Promise(resolve => setTimeout(resolve, 3_000))])
  expect(first, 'the first loop saw the peer').to.have.lengthOf(1)
  expect(second, 'the second loop saw the same peer').to.have.lengthOf(1)
  expect(first[0]).to.equal(second[0])
}

export const abortClosesOnlyThatConnection = async () => {
  const { port1, port2 } = newPair()
  let abortIt: (() => void) | undefined
  expose(
    context(ctx => { abortIt = ctx.abort; return { ping: async () => 'pong' } }),
    { transport: port1 },
  )
  const remote = await expose<{ ping: () => Promise<string> }>({}, { transport: port2 })
  await expect(remote.ping()).to.eventually.equal('pong')
  expect(abortIt, 'abort is on the context').to.be.a('function')
  abortIt!()
  await expect(remote.ping()).to.eventually.be.rejected
}

// Calling abort from inside the factory used to be a silent no-op AND the value had already been
// sent, so the obvious deny pattern handed the peer a working connection. The value is now built
// before the connection starts, so a refusal beats it out the door and the peer never resolves at all.
export const abortInsideTheFactoryRefusesTheConnection = async () => {
  const { port1, port2 } = newPair()
  expose(
    context(ctx => { ctx.abort?.(); return { ping: async () => 'pong' } }),
    { transport: port1 },
  )
  await expect(expose<{ ping: () => Promise<string> }>({}, { transport: port2 })).to.eventually.be.rejected
}

// A throwing factory has to settle BOTH sides. The close carries our uuid, and the peer only tracks
// us once it has seen our announce - which the announce branch sends before it builds anything, so
// channel ordering guarantees the peer is tracking us by the time the close lands.
export const throwingContextFactoryRejectsBothSides = async () => {
  const { port1, port2 } = newPair()
  const server = expose(
    context(() => { throw new Error('refused by policy') }),
    { transport: port1 },
  )
  const client = expose<{ ping: () => Promise<string> }>({}, { transport: port2 })
  await expect(server).to.eventually.be.rejectedWith('refused by policy')
  await expect(client).to.eventually.be.rejected
}

// Same, on the preset-uuid path, which skips the announce exchange entirely and registers the peer
// synchronously instead.
export const throwingContextFactoryRejectsBothSidesWithPresetUuids = async () => {
  const { port1, port2 } = newPair()
  const a = globalThis.crypto.randomUUID()
  const b = globalThis.crypto.randomUUID()
  const server = expose(
    context(() => { throw new Error('refused by policy') }),
    { transport: port1, uuid: a, remoteUuid: b },
  )
  const client = expose({}, { transport: port2, uuid: b, remoteUuid: a })
  await expect(server).to.eventually.be.rejectedWith('refused by policy')
  await expect(client).to.eventually.be.rejected
}

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

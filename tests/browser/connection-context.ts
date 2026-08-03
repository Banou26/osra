import { expect } from 'chai'

import type { Connected } from '../../src/index'

import { expose, context } from '../../src/index'

// The per-connection surface. Every case here stands for a defect that shipped once and must not again.

const newPair = () => new MessageChannel()

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

export const bareFunctionValueIsStillAnEndpoint = async () => {
  const { port1, port2 } = newPair()
  const value = async (n: number) => n * 2
  expose(value, { transport: port1 })
  const remote = await expose<typeof value>({}, { transport: port2 })
  await expect(remote(21)).to.eventually.equal(42)
}

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

export const theSelectorDecidesWhatAConnectionIs = async () => {
  const { port1, port2 } = newPair()
  const api = { ping: async () => 'pong' }
  expose(api, { transport: port1 })
  expose(api, { transport: port1, key: 'paired' })

  const bare = await expose<typeof api>({}, { transport: port2 })
  await expect(bare.ping(), 'no selector gives the remote itself').to.eventually.equal('pong')

  // No explicit type argument here, deliberately: TypeScript has no partial type-argument inference, so supplying one makes the selector's return type stop being inferred
  const { value, context: ctx } = await expose({}, {
    transport: port2,
    key: 'paired',
    connection: ({ value, context }: Connected<typeof api>) => ({ value, context }),
  })
  await expect(value.ping()).to.eventually.equal('pong')
  expect(typeof ctx.abort, 'the context carries this peer\'s abort').to.equal('function')
}

export const theSelectorCanReturnAnything = async () => {
  const { port1, port2 } = newPair()
  expose({ ping: async () => 'pong' }, { transport: port1 })
  const canDrop = await expose({}, {
    transport: port2,
    connection: ({ context }) => typeof context.abort === 'function',
  })
  expect(canDrop, 'a connection can be just the one thing this caller cares about').to.equal(true)
}

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

export const abortInsideTheFactoryRefusesTheConnection = async () => {
  const { port1, port2 } = newPair()
  expose(
    context(ctx => { ctx.abort?.(); return { ping: async () => 'pong' } }),
    { transport: port1 },
  )
  await expect(expose<{ ping: () => Promise<string> }>({}, { transport: port2 })).to.eventually.be.rejected
}

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

export const unregisterAbortEndsIteration = async () => {
  const { port1, port2 } = newPair()
  const controller = new AbortController()
  const connections = expose({}, { transport: port1, unregisterSignal: controller.signal })
  expose({}, { transport: port2 })
  let ended = false
  const looping = (async () => {
    for await (const _ of connections) {}
    ended = true
  })()
  controller.abort()
  await Promise.race([looping, new Promise(resolve => setTimeout(resolve, 2_000))])
  expect(ended, 'iteration terminated after the signal aborted').to.equal(true)
}

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

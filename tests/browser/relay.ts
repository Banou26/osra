import { expect } from 'chai'

import { expose, relay } from '../../src/index'

// workerA ─ chanA.port1 ── chanA.port2 ─ relay ─ chanB.port1 ── chanB.port2 ─ workerB

type Wire = {
  workerATransport: MessagePort
  workerBTransport: MessagePort
  relayController: AbortController
}

const wire = (opts?: { key?: string }): Wire => {
  const chanA = new MessageChannel()
  const chanB = new MessageChannel()
  // Neither expose nor relay starts ports - do it here so queued envelopes actually flow.
  chanA.port1.start()
  chanA.port2.start()
  chanB.port1.start()
  chanB.port2.start()

  const relayController = new AbortController()
  relay(chanA.port2, chanB.port1, {
    key: opts?.key,
    unregisterSignal: relayController.signal,
  })

  return {
    workerATransport: chanA.port1,
    workerBTransport: chanB.port2,
    relayController,
  }
}

export const relayedFunctionCall = async () => {
  const { workerATransport, workerBTransport } = wire()

  const apiA = { add: async (a: number, b: number) => a + b }
  expose(apiA, { transport: workerATransport })

  const remoteA = await expose<typeof apiA>({}, { transport: workerBTransport })
  await expect(remoteA.add(2, 3)).to.eventually.equal(5)
}

export const relayedBidirectional = async () => {
  const { workerATransport, workerBTransport } = wire()

  const apiA = { greet: async (name: string) => `A:${name}` }
  const apiB = { greet: async (name: string) => `B:${name}` }

  const remoteFromA = expose<typeof apiB>(apiA, { transport: workerATransport })
  const remoteFromB = expose<typeof apiA>(apiB, { transport: workerBTransport })

  const [bSide, aSide] = await Promise.all([remoteFromA, remoteFromB])

  await expect(bSide.greet('one')).to.eventually.equal('B:one')
  await expect(aSide.greet('two')).to.eventually.equal('A:two')
}

export const relayedCallback = async () => {
  const { workerATransport, workerBTransport } = wire()

  const apiA = {
    runWith: async (cb: (n: number) => Promise<number>) => (await cb(41)) + 1,
  }
  expose(apiA, { transport: workerATransport })

  const remoteA = await expose<typeof apiA>({}, { transport: workerBTransport })
  await expect(remoteA.runWith(async n => n + 1)).to.eventually.equal(43)
}

export const relayedArrayBuffer = async () => {
  const { workerATransport, workerBTransport } = wire()

  const buf = new ArrayBuffer(8)
  new Uint8Array(buf).set([1, 2, 3, 4, 5, 6, 7, 8])
  const apiA = { getBuf: async () => buf }
  expose(apiA, { transport: workerATransport })

  const remoteA = await expose<typeof apiA>({}, { transport: workerBTransport })
  const received = await remoteA.getBuf()

  expect(received).to.be.instanceOf(ArrayBuffer)
  expect(new Uint8Array(received)).to.deep.equal(
    new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]),
  )
}

export const relayedPromise = async () => {
  const { workerATransport, workerBTransport } = wire()

  const apiA = { fetchValue: async () => Promise.resolve('payload') }
  expose(apiA, { transport: workerATransport })

  const remoteA = await expose<typeof apiA>({}, { transport: workerBTransport })
  await expect(remoteA.fetchValue()).to.eventually.equal('payload')
}

export const relayedUserMessagePortTransfersEndToEnd = async () => {
  const { workerATransport, workerBTransport, relayController } = wire()

  const userChannel = new MessageChannel()
  const apiA = { takeMyPort: userChannel.port1 }
  expose(apiA, { transport: workerATransport })

  const remoteA = await expose<typeof apiA>({}, { transport: workerBTransport })
  expect(remoteA.takeMyPort).to.be.instanceOf(MessagePort)

  relayController.abort()

  remoteA.takeMyPort.start()
  userChannel.port2.start()

  const fromA = new Promise<unknown>(resolve =>
    remoteA.takeMyPort.addEventListener('message', e => resolve(e.data), { once: true }),
  )
  const fromB = new Promise<unknown>(resolve =>
    userChannel.port2.addEventListener('message', e => resolve(e.data), { once: true }),
  )
  userChannel.port2.postMessage('a→b')
  remoteA.takeMyPort.postMessage('b→a')

  await expect(fromA).to.eventually.equal('a→b')
  await expect(fromB).to.eventually.equal('b→a')
}

export const relayKeyIsolation = async () => {
  const chanA = new MessageChannel()
  const chanB = new MessageChannel()
  chanA.port1.start()
  chanA.port2.start()
  chanB.port1.start()
  chanB.port2.start()

  relay(chanA.port2, chanB.port1, { key: 'channel-a' })
  relay(chanA.port2, chanB.port1, { key: 'channel-b' })

  const apiA = { which: async () => 'A' }
  const apiB = { which: async () => 'B' }
  expose(apiA, { transport: chanA.port1, key: 'channel-a' })
  expose(apiB, { transport: chanA.port1, key: 'channel-b' })

  const remoteA = await expose<typeof apiA>({}, { transport: chanB.port2, key: 'channel-a' })
  const remoteB = await expose<typeof apiB>({}, { transport: chanB.port2, key: 'channel-b' })

  await expect(remoteA.which()).to.eventually.equal('A')
  await expect(remoteB.which()).to.eventually.equal('B')
}

export const relayUnregisterStopsForwarding = async () => {
  const { workerATransport, workerBTransport, relayController } = wire()

  relayController.abort()

  const apiA = { ping: async () => 'pong' }
  expose(apiA, { transport: workerATransport })

  let resolved = false
  expose<typeof apiA>({}, { transport: workerBTransport }).then(
    () => { resolved = true },
    () => { resolved = true },
  )
  await new Promise(r => setTimeout(r, 250))
  expect(resolved).to.be.false
}

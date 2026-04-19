import { expect } from 'chai'

import type { Message, Uuid } from '../../src/types'
import type { Transport } from '../../src'

import { expose } from '../../src/index'
import { makeJsonTransport } from './utils'

// Spy transport over a MessagePort — records every outbound envelope so
// tests can assert on uuids and message types exchanged during the handshake.
// Transferables must be forwarded: boxed functions/streams embed real
// MessagePorts that aren't structured-clonable without explicit transfer.
const spyTransport = (port: MessagePort, sink: Message[]): Transport => ({
  receive: (listener) => {
    port.addEventListener('message', event =>
      listener(event.data as Message, {}),
    )
  },
  emit: (message, transferables) => {
    sink.push(message)
    port.postMessage(message, transferables ?? [])
  },
})

// unregisterSignal: aborting it removes the protocol-level transport listener.
// Already-established function/promise ports keep working (they own their own
// MessageChannel). What aborts is the ability to set up *new* connections.
// We verify by aborting before any consumer attaches and confirming that a
// later expose() call cannot complete its handshake.
export const unregisterSignalBlocksNewConnections = async () => {
  const { port1, port2 } = new MessageChannel()
  port1.start()
  port2.start()

  const controller = new AbortController()
  const value = { ping: async () => 'pong' }
  expose(value, { transport: port1, unregisterSignal: controller.signal })

  // Abort before the remote side ever connects.
  controller.abort()

  // The remote's expose() returns a promise that resolves when the handshake
  // completes. With the exposer's listener torn down, the handshake never
  // completes and the promise must stay pending.
  let resolved = false
  expose<typeof value>({}, { transport: port2 }).then(
    () => { resolved = true },
    () => { resolved = true },
  )
  await new Promise(r => setTimeout(r, 250))
  expect(resolved).to.be.false
}

// Two independent connections sharing the same transport, distinguished by
// `key`. Messages on one key must not surface on the other.
export const keyIsolation = async () => {
  const { port1, port2 } = new MessageChannel()
  port1.start()
  port2.start()

  const valueA = { which: async () => 'A' }
  const valueB = { which: async () => 'B' }
  expose(valueA, { transport: port1, key: 'channel-a' })
  expose(valueB, { transport: port1, key: 'channel-b' })

  const remoteA = await expose<typeof valueA>({}, { transport: port2, key: 'channel-a' })
  const remoteB = await expose<typeof valueB>({}, { transport: port2, key: 'channel-b' })

  await expect(remoteA.which()).to.eventually.equal('A')
  await expect(remoteB.which()).to.eventually.equal('B')
}

// remoteName filtering: a listener with `remoteName` must only see envelopes
// whose `name` matches.
export const remoteNameFiltering = async () => {
  const { port1, port2 } = new MessageChannel()
  port1.start()
  port2.start()

  const value = { ping: async () => 'pong' }
  expose(value, { transport: port1, name: 'server' })

  const remote = await expose<typeof value>(
    {},
    { transport: port2, name: 'client', remoteName: 'server' },
  )
  await expect(remote.ping()).to.eventually.equal('pong')
}

// Passing `uuid` overrides the randomly-generated instance uuid. Every
// outbound envelope from that side must carry the custom value.
export const customUuidIsUsed = async () => {
  const { port1, port2 } = new MessageChannel()
  port1.start()
  port2.start()

  const sent: Message[] = []
  const customUuid = '11111111-1111-1111-1111-111111111111' as Uuid

  const value = { ping: async () => 'pong' }
  expose(value, { transport: port1 })

  const remote = await expose<typeof value>(
    {},
    { transport: spyTransport(port2, sent), uuid: customUuid },
  )

  await expect(remote.ping()).to.eventually.equal('pong')
  expect(sent.length).to.be.greaterThan(0)
  for (const m of sent) expect(m.uuid).to.equal(customUuid)
}

// When both sides preset each other's uuid via `remoteUuid`, the announce
// handshake is skipped entirely: init flows directly and no envelope of
// type 'announce' is ever emitted.
export const presetRemoteUuidSkipsAnnounce = async () => {
  const { port1, port2 } = new MessageChannel()
  port1.start()
  port2.start()

  const uuidA = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' as Uuid
  const uuidB = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' as Uuid

  const sentFromA: Message[] = []
  const sentFromB: Message[] = []

  const value = { ping: async () => 'pong' }
  expose(value, {
    transport: spyTransport(port1, sentFromA),
    uuid: uuidA,
    remoteUuid: uuidB,
  })

  const remote = await expose<typeof value>(
    {},
    {
      transport: spyTransport(port2, sentFromB),
      uuid: uuidB,
      remoteUuid: uuidA,
    },
  )

  await expect(remote.ping()).to.eventually.equal('pong')

  const all = [...sentFromA, ...sentFromB]
  expect(all.length).to.be.greaterThan(0)
  for (const m of all) expect(m.type).to.not.equal('announce')
  // Both sides must have skipped straight to init.
  expect(sentFromA.some(m => m.type === 'init')).to.be.true
  expect(sentFromB.some(m => m.type === 'init')).to.be.true
  expect(sentFromA.every(m => m.uuid === uuidA)).to.be.true
  expect(sentFromB.every(m => m.uuid === uuidB)).to.be.true
}

// Aborting `unregisterSignal` tears down a side's protocol listener. Calling
// expose() again on the same transport must complete a fresh handshake — the
// remote side doesn't re-expose, it just receives the new announce through
// its still-live listener and creates a second connection for the new uuid.
export const reregisterAfterCloseContinuesMessaging = async () => {
  const { port1, port2 } = new MessageChannel()
  port1.start()
  port2.start()

  const serverValue = { ping: async (n: number) => n + 1 }
  expose(serverValue, { transport: port2 })

  const controller1 = new AbortController()
  const client1 = await expose<typeof serverValue>(
    {},
    { transport: port1, unregisterSignal: controller1.signal },
  )
  expect(await client1.ping(1)).to.equal(2)

  controller1.abort()

  const client2 = await expose<typeof serverValue>({}, { transport: port1 })
  expect(await client2.ping(41)).to.equal(42)
}

// JSON-only transport: same coverage as keyIsolation to exercise the JSON path.
export const keyIsolationOverJson = async () => {
  const { port1, port2 } = new MessageChannel()
  port1.start()
  port2.start()

  const valueA = { which: async () => 'A' }
  const valueB = { which: async () => 'B' }
  expose(valueA, { transport: makeJsonTransport(port1), key: 'channel-a' })
  expose(valueB, { transport: makeJsonTransport(port1), key: 'channel-b' })

  const remoteA = await expose<typeof valueA>({}, { transport: makeJsonTransport(port2), key: 'channel-a' })
  const remoteB = await expose<typeof valueB>({}, { transport: makeJsonTransport(port2), key: 'channel-b' })

  await expect(remoteA.which()).to.eventually.equal('A')
  await expect(remoteB.which()).to.eventually.equal('B')
}

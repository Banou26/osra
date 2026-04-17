import { expect } from 'chai'

import { expose } from '../../src/index'
import { makeJsonTransport } from './utils'

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

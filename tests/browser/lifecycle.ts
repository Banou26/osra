import { expect } from 'chai'

import type { Message, Uuid } from '../../src/types'
import type { Transport } from '../../src'

import { expose } from '../../src/index'
import { makeJsonTransport } from './utils'

// Transferables must be forwarded: boxed functions/streams embed real MessagePorts that aren't structured-clonable without explicit transfer
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

export const unregisterSignalBlocksNewConnections = async () => {
  const { port1, port2 } = new MessageChannel()
  port1.start()
  port2.start()

  const controller = new AbortController()
  const value = { ping: async () => 'pong' }
  const exposerPromise = expose(value, { transport: port1, unregisterSignal: controller.signal })

  controller.abort()

  await expect(exposerPromise).to.eventually.be.rejected

  let resolved = false
  expose<typeof value>({}, { transport: port2 }).then(
    () => { resolved = true },
    () => { resolved = true },
  )
  await new Promise(r => setTimeout(r, 250))
  expect(resolved).to.be.false
}

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
  expect(sentFromA.some(m => m.type === 'init')).to.be.true
  expect(sentFromB.some(m => m.type === 'init')).to.be.true
  expect(sentFromA.every(m => m.uuid === uuidA)).to.be.true
  expect(sentFromB.every(m => m.uuid === uuidB)).to.be.true
}

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

export const announceRetrySurvivesLateLink = async () => {
  const { port1, port2 } = new MessageChannel()
  port1.start()
  port2.start()

  let linked = false
  const gated = (port: MessagePort, sink?: Message[]): Transport => ({
    receive: (listener) => {
      port.addEventListener('message', event => {
        if (linked) listener(event.data as Message, {})
      })
    },
    emit: (message, transferables) => {
      sink?.push(message)
      port.postMessage(message, transferables ?? [])
    },
  })

  const value = { ping: async () => 'pong' }
  const sent: Message[] = []
  expose(value, { transport: gated(port1) })
  const remotePromise = expose<typeof value>({}, { transport: gated(port2, sent) })

  await new Promise(resolve => setTimeout(resolve, 300))
  linked = true

  const remote = await remotePromise
  await expect(remote.ping()).to.eventually.equal('pong')

  const announceUuids = new Set(sent.filter(m => m.type === 'announce').map(m => m.uuid))
  expect(announceUuids.size).to.equal(1)
}

export const announceSurvivesThrowingEmit = async () => {
  const { port1, port2 } = new MessageChannel()
  port1.start()
  port2.start()

  let linked = false
  let failures = 0
  const flaky = (port: MessagePort): Transport => ({
    receive: (listener) => {
      port.addEventListener('message', event => listener(event.data as Message, {}))
    },
    emit: (message, transferables) => {
      if (!linked) {
        failures++
        throw new Error('link down')
      }
      port.postMessage(message, transferables ?? [])
    },
  })

  const value = { ping: async () => 'pong' }
  expose(value, { transport: flaky(port1) })
  const remotePromise = expose<typeof value>({}, { transport: flaky(port2) })

  await new Promise(resolve => setTimeout(resolve, 300))
  linked = true

  const remote = await remotePromise
  await expect(remote.ping()).to.eventually.equal('pong')
  expect(failures).to.be.greaterThan(0)
}

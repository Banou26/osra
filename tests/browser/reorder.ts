import type { Transport } from '../../src'
import type { Message, Uuid } from '../../src/types'
import type { MessageContext } from '../../src/utils/transport'

import { expect } from 'chai'

import { expose, relay } from '../../src/index'
import { OSRA_BOX, OSRA_KEY, OSRA_DEFAULT_KEY } from '../../src/types'
import { makeJsonTransport } from './utils'

// regression coverage for the per-port sequence + reorder-buffer fix (0.5.7): on a connectionless
// transport a reordered chunk storm corrupted a stream's content or wedged the consumer forever

type Listener = (message: Message, ctx: MessageContext) => void

// with `reorder`, every message emitted within one macrotask tick is flushed REVERSED on the next tick
const transportPair = (reorder: boolean): { a: Transport, b: Transport } => {
  const listeners: Partial<Record<'a' | 'b', Listener>> = {}
  const side = (self: 'a' | 'b', other: 'a' | 'b'): Transport => {
    let batch: Message[] = []
    let scheduled = false
    return {
      isJson: true,
      receive: (listener: Listener) => { listeners[self] = listener },
      emit: (message: Message) => {
        batch.push(JSON.parse(JSON.stringify(message)) as Message)
        if (scheduled) return
        scheduled = true
        setTimeout(() => {
          const out = reorder ? batch.reverse() : batch
          batch = []
          scheduled = false
          for (const m of out) listeners[other]?.(m, {})
        }, 0)
      },
    }
  }
  return { a: side('a', 'b'), b: side('b', 'a') }
}

const sequentialStream = (count: number): ReadableStream<number> => {
  let i = 0
  return new ReadableStream({
    pull: (controller) => {
      if (i < count) controller.enqueue(i++)
      else controller.close()
    },
  })
}

const readAll = async (stream: ReadableStream<number>): Promise<number[]> => {
  const reader = stream.getReader()
  const out: number[] = []
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    out.push(value as number)
  }
  return out
}

const CHUNKS = 300

export const streamSurvivesReorderingTransport = async () => {
  const { a, b } = transportPair(true)
  const apiA = { stream: async () => sequentialStream(CHUNKS) }
  expose(apiA, { transport: a })
  const remote = await expose<typeof apiA>({}, { transport: b })

  const received = await readAll(await remote.stream())
  expect(received, 'every chunk delivered').to.have.lengthOf(CHUNKS)
  expect(received, 'delivered in send-order').to.deep.equal([...Array(CHUNKS).keys()])
}

export const streamSurvivesReorderingRelay = async () => {
  const producerSide = transportPair(false)
  const consumerSide = transportPair(true)
  relay(producerSide.b, consumerSide.a)

  const apiA = { stream: async () => sequentialStream(CHUNKS) }
  expose(apiA, { transport: producerSide.a })
  const remote = await expose<typeof apiA>({}, { transport: consumerSide.b })

  const received = await readAll(await remote.stream())
  expect(received, 'every chunk delivered').to.have.lengthOf(CHUNKS)
  expect(received, 'delivered in send-order').to.deep.equal([...Array(CHUNKS).keys()])
}

export const callbackBurstSurvivesReorderingTransport = async () => {
  const { a, b } = transportPair(true)
  const seen: number[] = []
  const apiA = {
    drive: async (cb: (n: number) => void) => {
      for (let i = 0; i < 64; i++) cb(i)
    },
  }
  expose(apiA, { transport: a })
  const remote = await expose<typeof apiA>({}, { transport: b })

  await remote.drive((n) => { seen.push(n) })
  await new Promise((resolve) => setTimeout(resolve, 200))
  expect(seen, 'callbacks fire in call-order').to.deep.equal([...Array(64).keys()])
}

// mirror the (unexported) limits in src/revivables/message-port.ts
const REORDER_LIMIT = 2048
const PENDING_PORT_LIMIT = 1024

type TakenPort = { messages: unknown[], closes: number }

const boxedPort = (portId: string, synthetic: boolean) => ({
  [OSRA_BOX]: 'revivable',
  type: 'messagePort',
  portId,
  synthetic,
})

const connectWirePeer = async () => {
  const { port1, port2 } = new MessageChannel()
  const peerUuid = crypto.randomUUID() as Uuid
  const taken: TakenPort[] = []
  const api = {
    take: async (port: MessagePort) => {
      const entry: TakenPort = { messages: [], closes: 0 }
      taken.push(entry)
      port.addEventListener('message', event => { entry.messages.push((event as MessageEvent).data) })
      port.addEventListener('close', () => { entry.closes++ })
      port.start()
    },
  }
  expose(api, { transport: makeJsonTransport(port1) })

  const received: Record<string, any>[] = []
  const waiters: { predicate: (message: Record<string, any>) => boolean, resolve: (message: Record<string, any>) => void }[] = []
  port2.addEventListener('message', event => {
    const message = JSON.parse((event as MessageEvent).data as string) as Record<string, any>
    received.push(message)
    const index = waiters.findIndex(waiter => waiter.predicate(message))
    if (index !== -1) waiters.splice(index, 1)[0]!.resolve(message)
  })
  port2.start()

  const waitFor = (predicate: (message: Record<string, any>) => boolean) => {
    const existing = received.find(predicate)
    if (existing) return Promise.resolve(existing)
    return new Promise<Record<string, any>>(resolve => { waiters.push({ predicate, resolve }) })
  }

  const send = (message: Record<string, unknown>) => {
    port2.postMessage(JSON.stringify({ [OSRA_KEY]: OSRA_DEFAULT_KEY, uuid: peerUuid, ...message }))
  }

  const announce = await waitFor(message => message.type === 'announce' && !message.remoteUuid)
  const localUuid = announce.uuid as Uuid
  send({ type: 'announce', remoteUuid: localUuid })
  const init = await waitFor(message => message.type === 'init')
  send({ type: 'init', remoteUuid: localUuid, data: null })
  const takePortId = init.data.take.port.portId as string

  let takeSeq = 0
  const sendPortMessage = (portId: string, seq: number, data: unknown) => {
    send({ type: 'message', remoteUuid: localUuid, portId, seq, data })
  }
  const sendPortClose = (portId: string, seq: number) => {
    send({ type: 'message-port-close', remoteUuid: localUuid, portId, seq })
  }
  const callTake = async (argPortId: string) => {
    const returnPortId = crypto.randomUUID()
    sendPortMessage(takePortId, takeSeq++, [boxedPort(returnPortId, true), [boxedPort(argPortId, false)]])
    await waitFor(message => message.type === 'message' && message.portId === returnPortId)
  }

  return { taken, sendPortMessage, sendPortClose, callTake }
}

const settle = () => new Promise(resolve => setTimeout(resolve, 50))

export const closedPortIgnoresLateMessages = async () => {
  const peer = await connectWirePeer()
  const portId = crypto.randomUUID()
  await peer.callTake(portId)
  peer.sendPortMessage(portId, 0, 'pre-close')
  // WebKit drops in-flight local port messages when the entangled end closes right behind them
  await settle()
  peer.sendPortClose(portId, 1)
  peer.sendPortMessage(portId, 2, 'late-a')
  peer.sendPortMessage(portId, 3, 'late-b')

  const freshPortId = crypto.randomUUID()
  await peer.callTake(freshPortId)
  peer.sendPortMessage(freshPortId, 0, 'fresh')
  await settle()

  expect(peer.taken[0]!.messages).to.deep.equal(['pre-close'])
  expect(peer.taken[0]!.closes).to.equal(1)
  expect(peer.taken[1]!.messages).to.deep.equal(['fresh'])
  expect(peer.taken[1]!.closes).to.equal(0)
}

export const reviveOfTombstonedPortIdFiresClose = async () => {
  const peer = await connectWirePeer()
  const portId = crypto.randomUUID()
  await peer.callTake(portId)
  peer.sendPortClose(portId, 0)
  await peer.callTake(portId)
  await settle()

  expect(peer.taken[0]!.closes).to.equal(1)
  expect(peer.taken[1]!.closes).to.equal(1)
  expect(peer.taken[1]!.messages).to.deep.equal([])
}

export const reorderOverflowFailsPortClosed = async () => {
  const peer = await connectWirePeer()
  const portId = crypto.randomUUID()
  await peer.callTake(portId)
  // seq 0 never arrives: everything buffers until the cap fails the port
  for (let seq = 1; seq <= REORDER_LIMIT + 1; seq++) peer.sendPortMessage(portId, seq, seq)

  const freshPortId = crypto.randomUUID()
  await peer.callTake(freshPortId)
  peer.sendPortMessage(freshPortId, 0, 'alive')
  await settle()

  expect(peer.taken[0]!.messages).to.deep.equal([])
  expect(peer.taken[0]!.closes).to.equal(1)
  expect(peer.taken[1]!.messages).to.deep.equal(['alive'])
}

export const earlyPortMessageBuffersBelowPendingCap = async () => {
  const peer = await connectWirePeer()
  for (let i = 0; i < PENDING_PORT_LIMIT - 1; i++) {
    peer.sendPortMessage(crypto.randomUUID(), 0, i)
  }
  const portId = crypto.randomUUID()
  peer.sendPortMessage(portId, 0, 'early')
  await peer.callTake(portId)
  peer.sendPortMessage(portId, 1, 'follow-up')
  await settle()

  expect(peer.taken[0]!.messages).to.deep.equal(['early', 'follow-up'])
}

export const earlyPortMessageDroppedAtPendingCap = async () => {
  const peer = await connectWirePeer()
  for (let i = 0; i < PENDING_PORT_LIMIT; i++) {
    peer.sendPortMessage(crypto.randomUUID(), 0, i)
  }
  const portId = crypto.randomUUID()
  peer.sendPortMessage(portId, 0, 'dropped-early')
  await peer.callTake(portId)
  peer.sendPortMessage(portId, 0, 'delivered')
  await settle()

  expect(peer.taken[0]!.messages).to.deep.equal(['delivered'])
}

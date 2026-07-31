import type { Transport } from '../../src'
import type { Message, Uuid } from '../../src/types'
import type { MessageContext } from '../../src/utils/transport'

import { expect } from 'chai'

import { expose, relay } from '../../src/index'
import { OSRA_BOX, OSRA_KEY, OSRA_DEFAULT_KEY } from '../../src/types'
import { makeJsonTransport } from './utils'

// Regression coverage for the per-port sequence + reorder-buffer fix (0.5.7).
//
// A connectionless transport (chrome's runtime.sendMessage between a content
// script and the service worker) gives NO ordering guarantee: a logical port's
// messages can arrive out of order under concurrency. osra multiplexes a
// stream's chunk/credit/end/close traffic over one such port, and the protocol
// pre-0.5.7 assumed in-order delivery - so a reordered chunk storm corrupted
// the stream's content or let its close overtake trailing chunks, wedging the
// consumer forever (the heimdall rapid-seek deadlock). The fix stamps each port
// message with a monotonic seq and the receiver delivers strictly in send-order.
// These tests reproduce the reordering at the transport and assert the stream
// survives it; before the fix they corrupt the byte order or hang.

type Listener = (message: Message, ctx: MessageContext) => void

// A self-contained JSON transport pair (a <-> b). When `reorder` is set, every
// message emitted within one macrotask tick is flushed REVERSED on the next
// tick. Causally-separated traffic (the handshake, a call and its return) lands
// alone in its own tick and is untouched; a synchronous burst (a stream's chunk
// pump, whose posts chain across microtasks inside one macrotask) is fully
// reversed - the exact condition that broke the old protocol.
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

// The fix's core guarantee, end to end through the public API: a stream
// multiplexed over a reordering transport still arrives complete and in order.
export const streamSurvivesReorderingTransport = async () => {
  const { a, b } = transportPair(true)
  const apiA = { stream: async () => sequentialStream(CHUNKS) }
  expose(apiA, { transport: a })
  const remote = await expose<typeof apiA>({}, { transport: b })

  const received = await readAll(await remote.stream())
  expect(received, 'every chunk delivered').to.have.lengthOf(CHUNKS)
  expect(received, 'delivered in send-order').to.deep.equal([...Array(CHUNKS).keys()])
}

// Same guarantee through the actual failing topology: producer -> relay ->
// consumer, where only the relay<->consumer hop reorders (mirroring the
// content-script<->service-worker link that wedged seeking). The relay re-boxes
// the stream onto a fresh port, so this exercises sequencing across the hop.
export const streamSurvivesReorderingRelay = async () => {
  const producerSide = transportPair(false) // producer <-> relay: ordered
  const consumerSide = transportPair(true)  // relay <-> consumer: reordering
  relay(producerSide.b, consumerSide.a)

  const apiA = { stream: async () => sequentialStream(CHUNKS) }
  expose(apiA, { transport: producerSide.a })
  const remote = await expose<typeof apiA>({}, { transport: consumerSide.b })

  const received = await readAll(await remote.stream())
  expect(received, 'every chunk delivered').to.have.lengthOf(CHUNKS)
  expect(received, 'delivered in send-order').to.deep.equal([...Array(CHUNKS).keys()])
}

// A reordered transport must not corrupt ordinary multi-message port traffic
// either: a callback invoked many times in a burst must fire in call-order.
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
  // Let the reversed macrotask batches flush.
  await new Promise((resolve) => setTimeout(resolve, 200))
  expect(seen, 'callbacks fire in call-order').to.deep.equal([...Array(64).keys()])
}

// Routing hardening (0.6.0): closed portIds are tombstoned so late in-flight
// messages can't resurrect routing state, handler-less routing entries are
// bounded, and a reorder buffer whose gap can't close fails the port closed.
// Driven by a hand-rolled wire peer so portIds, seqs, and ordering are fully
// deterministic.

// Mirror the (unexported) limits in src/revivables/message-port.ts.
const REORDER_LIMIT = 2048
const PENDING_PORT_LIMIT = 1024

type TakenPort = { messages: unknown[], closes: number }

const boxedPort = (portId: string, synthetic: boolean) => ({
  [OSRA_BOX]: 'revivable',
  type: 'messagePort',
  portId,
  synthetic,
})

// Exposes { take } locally over a JSON MessagePort transport and hand-rolls
// the peer's side of the protocol: announce/init handshake, then raw port
// messages with caller-chosen portIds and seqs.
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

// A wire close tombstones the portId: late in-flight messages for it are
// dropped and unrelated ports keep working.
export const closedPortIgnoresLateMessages = async () => {
  const peer = await connectWirePeer()
  const portId = crypto.randomUUID()
  await peer.callTake(portId)
  peer.sendPortMessage(portId, 0, 'pre-close')
  // Let the pre-close delivery land: WebKit drops in-flight local port
  // messages when the entangled end closes right behind them.
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

// Reviving a boxed port whose portId was already closed must yield a port
// whose synthesized 'close' is still observable by the consumer - the
// listener is only attached after the revived port is delivered.
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

// A reorder buffer whose gap never closes must fail the port closed at the
// cap instead of growing forever or wedging silently.
export const reorderOverflowFailsPortClosed = async () => {
  const peer = await connectWirePeer()
  const portId = crypto.randomUUID()
  await peer.callTake(portId)
  // seq 0 never arrives: everything buffers until the cap fails the port.
  for (let seq = 1; seq <= REORDER_LIMIT + 1; seq++) peer.sendPortMessage(portId, seq, seq)

  const freshPortId = crypto.randomUUID()
  await peer.callTake(freshPortId)
  peer.sendPortMessage(freshPortId, 0, 'alive')
  await settle()

  expect(peer.taken[0]!.messages).to.deep.equal([])
  expect(peer.taken[0]!.closes).to.equal(1)
  expect(peer.taken[1]!.messages).to.deep.equal(['alive'])
}

// Messages arriving before their port's handler registers allocate a pending
// routing entry - admitted and buffered right up to the cap.
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

// At the cap, an early message for an unknown portId is dropped instead of
// allocating another entry - and the port itself still works once its box
// registers the handler.
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

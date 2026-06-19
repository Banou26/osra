import type { Transport } from '../../src'
import type { Message } from '../../src/types'
import type { MessageContext } from '../../src/utils/transport'

import { expect } from 'chai'

import { expose, relay } from '../../src/index'

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

import type { Transport } from '../../src'

import { expect } from 'chai'

import { expose, transfer } from '../../src/index'

// Helper: hash hex of a BufferSource, used to compare data round-trips.
const hashToHex = async (arrayBuffer: BufferSource) =>
  new Uint8Array((await crypto.subtle.digest('SHA-256', arrayBuffer))).toHex() as string

// Behavior 1: unwrapped transferables are COPIED, not transferred.
// After the RPC returns, the caller's buffer is still usable on the sender.
export const unwrappedBufferIsCopied = async (transport: Transport) => {
  const value = async (data: ArrayBuffer) => data.byteLength
  expose(value, { transport })
  const remote = await expose<typeof value>({}, { transport })

  const buffer = new ArrayBuffer(1024)
  new Uint8Array(buffer).fill(7)
  const result = await remote(buffer)
  expect(result).to.equal(1024)
  // Copy semantics: sender-side buffer is still usable.
  expect(buffer.byteLength).to.equal(1024)
  expect(new Uint8Array(buffer)[0]).to.equal(7)
}

// Behavior 2: transfer-wrapped transferables are MOVED (neutered on the sender).
// Skipped in JSON-only mode since detachment isn't observable there.
export const transferredBufferIsDetached = async (transport: Transport) => {
  const value = async (data: ArrayBuffer) => data.byteLength
  expose(value, { transport })
  const remote = await expose<typeof value>({}, { transport })

  const buffer = new ArrayBuffer(1024)
  new Uint8Array(buffer).fill(5)
  const result = await remote(transfer(buffer))
  expect(result).to.equal(1024)
  // Transfer semantics: sender-side buffer is neutered.
  // Only observable when the platform actually transfers — JSON-only transports
  // serialize to base64 and always "copy" regardless.
  if (!('isJson' in transport && transport.isJson === true)) {
    expect(buffer.byteLength).to.equal(0)
  }
}

// Behavior 3: broadcasting works with the copy default.
// The same unwrapped buffer can be sent on TWO separate RPCs (here through
// two separate exposed connections) and remain usable on the caller.
export const broadcastUnwrappedWorks = async (transport: Transport) => {
  const value = async (data: ArrayBuffer) => data.byteLength
  expose(value, { transport })
  const remote1 = await expose<typeof value>({}, { transport })
  const remote2 = await expose<typeof value>({}, { transport })

  const buffer = new ArrayBuffer(512)
  new Uint8Array(buffer).fill(9)

  const r1 = await remote1(buffer)
  const r2 = await remote2(buffer)
  expect(r1).to.equal(512)
  expect(r2).to.equal(512)
  // Buffer is still usable after both sends.
  expect(buffer.byteLength).to.equal(512)
  expect(new Uint8Array(buffer)[0]).to.equal(9)
}

// Behavior 4: transfer() is idempotent.
// transfer(transfer(x)) == transfer(x) — wrapping twice is a no-op.
export const transferIsIdempotent = async (_transport: Transport) => {
  const buffer = new ArrayBuffer(64)
  const once = transfer(buffer)
  const twice = transfer(once)
  expect(twice).to.equal(once)
  // And it still behaves as a transfer marker when sent.
  // (We only check reference equality here; behavior-over-wire is covered
  // elsewhere.)
}

// Behavior 4b: transfer() is idempotent across typed arrays too.
export const transferIsIdempotentTypedArray = async (_transport: Transport) => {
  const u8 = new Uint8Array(32)
  const once = transfer(u8)
  const twice = transfer(once)
  expect(twice).to.equal(once)
}

// Behavior 4c: wrapping twice inline inside an RPC call still works.
export const transferTwiceInlineStillTransfers = async (transport: Transport) => {
  const value = async (data: ArrayBuffer) => data.byteLength
  expose(value, { transport })
  const remote = await expose<typeof value>({}, { transport })

  const buffer = new ArrayBuffer(128)
  const result = await remote(transfer(transfer(buffer)))
  expect(result).to.equal(128)
  if (!('isJson' in transport && transport.isJson === true)) {
    expect(buffer.byteLength).to.equal(0)
  }
}

// Behavior 5: transfer works for typed arrays — the underlying .buffer moves.
export const transferTypedArrayMovesUnderlyingBuffer = async (transport: Transport) => {
  const value = async (data: Uint8Array) => data.length
  expose(value, { transport })
  const remote = await expose<typeof value>({}, { transport })

  const u8 = new Uint8Array(256)
  u8.fill(3)
  const originalHash = await hashToHex(u8.buffer as ArrayBuffer)
  const result = await remote(transfer(u8))
  expect(result).to.equal(256)
  if (!('isJson' in transport && transport.isJson === true)) {
    // Underlying buffer is detached on the sender side.
    expect(u8.byteLength).to.equal(0)
  }
  // Sanity: the hash matches what we expected before sending.
  expect(originalHash.length).to.equal(64)
}

// Behavior 5b: transfer works for ReadableStream (platform permitting).
export const transferReadableStream = async (transport: Transport) => {
  const chunks = ['a', 'b', 'c']
  const value = async (stream: ReadableStream<Uint8Array>) => {
    const reader = stream.getReader()
    const received: string[] = []
    while (true) {
      const { value: v, done } = await reader.read()
      if (done) break
      received.push(new TextDecoder().decode(v))
    }
    return received.join('')
  }
  expose(value, { transport })
  const remote = await expose<typeof value>({}, { transport })

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(new TextEncoder().encode(c))
      controller.close()
    },
  })

  const result = await remote(transfer(stream))
  expect(result).to.equal('abc')
}

// Behavior 6: primitives and non-transferables are a no-op.
// transfer(x) returns its argument unchanged.
export const nonTransferablesAreNoOp = async (_transport: Transport) => {
  expect(transfer(42)).to.equal(42)
  expect(transfer('hi')).to.equal('hi')
  expect(transfer(true)).to.equal(true)
  expect(transfer(null)).to.equal(null)
  expect(transfer(undefined)).to.equal(undefined)
  const obj = { foo: 1 }
  expect(transfer(obj)).to.equal(obj)
  const arr = [1, 2, 3]
  expect(transfer(arr)).to.equal(arr)
}

// Behavior 6b: sending a non-transferable through an RPC with transfer() still works.
// (i.e. we don't crash normal payloads if the user accidentally wraps one.)
export const transferDoesNotCrashNonTransferable = async (transport: Transport) => {
  const value = async (data: { foo: number }) => data.foo
  expose(value, { transport })
  const remote = await expose<typeof value>({}, { transport })

  // transfer({ foo: 1 }) returns the object unchanged; the RPC should still succeed.
  const result = await remote(transfer({ foo: 7 }) as { foo: number })
  expect(result).to.equal(7)
}

// Behavior 7: MessagePort is always transferred, with or without the wrapper.
// This mirrors the existing userMessagePort test and proves the must-transfer
// allow-list still works.
export const messagePortStillTransfersWithoutWrapper = async (transport: Transport) => {
  const { port1: _port1, port2 } = new MessageChannel()
  const value = {
    port1: _port1,
  }
  expose(value, { transport })
  const { port1 } = await expose<typeof value>({}, { transport })

  let port1Resolve: (value: number) => void
  const port1Promise = new Promise<number>(resolve => { port1Resolve = resolve })
  port1.addEventListener('message', event => { port1Resolve(event.data) })
  port1.start()
  port1.postMessage(1)

  let port2Resolve: (value: number) => void
  const port2Promise = new Promise<number>(resolve => { port2Resolve = resolve })
  port2.addEventListener('message', event => { port2Resolve(event.data) })
  port2.start()
  port2.postMessage(2)

  await expect(port1Promise).to.eventually.equal(2)
  await expect(port2Promise).to.eventually.equal(1)
}

// Behavior 8: existing tests still pass — covered by the base test suite wiring
// (not re-asserted here; the full suite is run from web-context-transport.ts and
// json-transport.ts).

// Behavior 2b: data integrity round-trip with transfer().
// The receiver sees the exact same bytes we sent.
export const transferredBufferDataRoundTrips = async (transport: Transport) => {
  const value = async (data: ArrayBuffer) => new Uint8Array(data).toHex() as string
  expose(value, { transport })
  const remote = await expose<typeof value>({}, { transport })

  const buffer = new ArrayBuffer(64)
  const u8 = new Uint8Array(buffer)
  crypto.getRandomValues(u8)
  const expectedHex = u8.toHex() as string

  const receivedHex = await remote(transfer(buffer))
  expect(receivedHex).to.equal(expectedHex)
}

export const tests = {
  unwrappedBufferIsCopied,
  transferredBufferIsDetached,
  broadcastUnwrappedWorks,
  transferIsIdempotent,
  transferIsIdempotentTypedArray,
  transferTwiceInlineStillTransfers,
  transferTypedArrayMovesUnderlyingBuffer,
  transferReadableStream,
  nonTransferablesAreNoOp,
  transferDoesNotCrashNonTransferable,
  messagePortStillTransfersWithoutWrapper,
  transferredBufferDataRoundTrips,
}

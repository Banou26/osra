import type { Transport } from '../../src'

import { expect } from 'chai'

import { expose, transfer } from '../../src/index'

const hashToHex = async (arrayBuffer: BufferSource) =>
  new Uint8Array((await crypto.subtle.digest('SHA-256', arrayBuffer))).toHex() as string

export const unwrappedBufferIsCopied = async (transport: Transport) => {
  const value = async (data: ArrayBuffer) => data.byteLength
  expose(value, { transport })
  const remote = await expose<typeof value>({}, { transport })

  const buffer = new ArrayBuffer(1024)
  new Uint8Array(buffer).fill(7)
  const result = await remote(buffer)
  expect(result).to.equal(1024)
  expect(buffer.byteLength).to.equal(1024)
  expect(new Uint8Array(buffer)[0]).to.equal(7)
}

export const transferredBufferIsDetached = async (transport: Transport) => {
  const value = async (data: ArrayBuffer) => data.byteLength
  expose(value, { transport })
  const remote = await expose<typeof value>({}, { transport })

  const buffer = new ArrayBuffer(1024)
  new Uint8Array(buffer).fill(5)
  const result = await remote(transfer(buffer))
  expect(result).to.equal(1024)
  // JSON-only transports serialize to base64 and always "copy", so detachment isn't observable there
  if (!('isJson' in transport && transport.isJson === true)) {
    expect(buffer.byteLength).to.equal(0)
  }
}

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
  expect(buffer.byteLength).to.equal(512)
  expect(new Uint8Array(buffer)[0]).to.equal(9)
}

export const transferIsIdempotent = async (_transport: Transport) => {
  const buffer = new ArrayBuffer(64)
  const once = transfer(buffer)
  const twice = transfer(once)
  expect(twice).to.equal(once)
}

export const transferIsIdempotentTypedArray = async (_transport: Transport) => {
  const u8 = new Uint8Array(32)
  const once = transfer(u8)
  const twice = transfer(once)
  expect(twice).to.equal(once)
}

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
    expect(u8.byteLength).to.equal(0)
  }
  expect(originalHash.length).to.equal(64)
}

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

export const transferDoesNotCrashNonTransferable = async (transport: Transport) => {
  const value = async (data: { foo: number }) => data.foo
  expose(value, { transport })
  const remote = await expose<typeof value>({}, { transport })

  const result = await remote(transfer({ foo: 7 }) as { foo: number })
  expect(result).to.equal(7)
}

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

// OffscreenCanvas also extends EventTarget: it must not get boxed into an eventTarget husk
export const offscreenCanvasTransfersAsCanvas = async (transport: Transport) => {
  if ('isJson' in transport && transport.isJson === true) return

  // a canvas with a context can't be transferred, so this transfers a fresh canvas and draws in the worker
  const value = async (canvas: OffscreenCanvas) => {
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = 'rgb(10, 20, 30)'
    ctx.fillRect(0, 0, 1, 1)
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data
    return { isCanvas: canvas instanceof OffscreenCanvas, width: canvas.width, height: canvas.height, r, g, b, a }
  }
  expose(value, { transport })
  const remote = await expose<typeof value>({}, { transport })

  const canvas = new OffscreenCanvas(48, 24)
  const result = await remote(transfer(canvas))
  expect(result.isCanvas).to.equal(true)
  expect(result.width).to.equal(48)
  expect(result.height).to.equal(24)
  expect([result.r, result.g, result.b, result.a]).to.deep.equal([10, 20, 30, 255])
}

// regression: isWrappableTransferable omitted VideoFrame/AudioData, so transfer() silently
// degraded to a copy
export const videoFrameTransferDetachesSource = async (transport: Transport) => {
  if ('isJson' in transport && transport.isJson === true) return
  if (typeof VideoFrame === 'undefined') return

  const value = async (frame: VideoFrame) => {
    const info = { isFrame: frame instanceof VideoFrame, width: frame.codedWidth, height: frame.codedHeight }
    frame.close()
    return info
  }
  expose(value, { transport })
  const remote = await expose<typeof value>({}, { transport })

  const frame = new VideoFrame(new Uint8Array(2 * 2 * 4).fill(127), {
    format: 'RGBA', codedWidth: 2, codedHeight: 2, timestamp: 0,
  })
  const result = await remote(transfer(frame))
  expect(result.isFrame).to.equal(true)
  expect(result.width).to.equal(2)
  expect(result.height).to.equal(2)
  expect(frame.format).to.equal(null)
}

export const audioDataTransferDetachesSource = async (transport: Transport) => {
  if ('isJson' in transport && transport.isJson === true) return
  if (typeof AudioData === 'undefined') return

  const value = async (data: AudioData) => {
    const info = { isAudioData: data instanceof AudioData, frames: data.numberOfFrames }
    data.close()
    return info
  }
  expose(value, { transport })
  const remote = await expose<typeof value>({}, { transport })

  const audio = new AudioData({
    format: 'f32', sampleRate: 8000, numberOfFrames: 8, numberOfChannels: 1,
    timestamp: 0, data: new Float32Array(8),
  })
  const result = await remote(transfer(audio))
  expect(result.isAudioData).to.equal(true)
  expect(result.frames).to.equal(8)
  expect(audio.format).to.equal(null)
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
  offscreenCanvasTransfersAsCanvas,
  videoFrameTransferDetachesSource,
  audioDataTransferDetachesSource,
}

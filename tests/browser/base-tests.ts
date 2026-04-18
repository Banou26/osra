import type { Transport } from '../../src'

import { expect } from 'chai'

import { expose } from '../../src/index'

export const argsAndResponse = async (transport: Transport) => {
  const value = async (data: { foo: number }, bar: string) => {
    if (data.foo !== 1) {
      throw new Error('foo is not 1')
    }
    if (bar !== 'bar') {
      throw new Error('bar is not bar')
    }
    return 1
  }
  expose(value, { transport })

  const test = await expose<typeof value>({}, { transport })

  await expect(test({ foo: 1 }, 'bar')).to.eventually.equal(1)
  await expect(test({ foo: 0 }, 'baz')).to.be.rejected
}

export const callback = async (transport: Transport) => {
  const value = async () => async () => 1
  expose(value, { transport })

  const test = await expose<typeof value>({}, { transport })

  const result = await test()
  await expect(result()).to.eventually.equal(1)
}

export const callbackAsArg = async (transport: Transport) => {
  const value = async (callback: () => number) => callback()
  expose(value, { transport })

  const test = await expose<typeof value>({}, { transport })

  const result = await test(() => 1)
  expect(result).to.equal(1)
}

export const objectBaseArgsAndResponse = async (transport: Transport) => {
  const value = {
    test: async (data: { foo: number }, bar: string) => {
      if (data.foo !== 1) {
        throw new Error('foo is not 1')
      }
      if (bar !== 'bar') {
        throw new Error('bar is not bar')
      }
      return 1
    }
  }
  expose(value, { transport })

  const { test } = await expose<typeof value>({}, { transport })

  await expect(test({ foo: 1 }, 'bar')).to.eventually.equal(1)
  await expect(test({ foo: 0 }, 'baz')).to.be.rejected
}

export const objectCallback = async (transport: Transport) => {
  const value = {
    test: async () => async () => 1
  }
  expose(value, { transport })

  const { test } = await expose<typeof value>({}, { transport })

  const result = await test()
  await expect(result()).to.eventually.equal(1)
}

export const objectCallbackAsArg = async (transport: Transport) => {
  const value = {
    test: async (callback: () => number) => callback()
  }
  expose(value, { transport })

  const { test } = await expose<typeof value>({}, { transport })

  const result = await test(() => 1)
  expect(result).to.equal(1)
}

export const userMessagePort = async (transport: Transport) => {
  const { port1: _port1, port2 } = new MessageChannel()
  const value = {
    port1: _port1
  }
  expose(value, { transport })

  const { port1 } = await expose<typeof value>({}, { transport })

  // A user-owned MessagePort must revive as a real MessagePort regardless
  // of whether the transport supports structured clone or is JSON-only.
  expect(port1).to.be.instanceOf(MessagePort)

  let port1Resolve: ((value: number) => void)
  const port1Promise = new Promise<number>(resolve => port1Resolve = resolve)
  port1.addEventListener('message', event => {
    port1Resolve(event.data)
  })
  port1.start()
  port1.postMessage(1)

  let port2Resolve: ((value: number) => void)
  const port2Promise = new Promise<number>(resolve => port2Resolve = resolve)
  port2.addEventListener('message', event => {
    port2Resolve(event.data)
  })
  port2.start()
  port2.postMessage(2)

  await expect(port1Promise).to.eventually.equal(2)
  await expect(port2Promise).to.eventually.equal(1)
}

export const userPromise = async (transport: Transport) => {
  const value = {
    promise: Promise.resolve(1)
  }
  expose(value, { transport })

  const { promise } = await expose<typeof value>({}, { transport })

  await expect(promise).to.eventually.equal(1)
}

const hashToHex = async (arrayBuffer: BufferSource) =>
  new Uint8Array((await crypto.subtle.digest('SHA-256', arrayBuffer))).toHex() as string

export const userArrayBuffer = async (transport: Transport) => {
  const _arrayBuffer = new ArrayBuffer(100)
  const uint8Array = new Uint8Array(_arrayBuffer)
  crypto.getRandomValues(uint8Array)
  const originalHash = await hashToHex(_arrayBuffer)
  const value = {
    arrayBuffer: _arrayBuffer
  }
  expose(value, { transport })

  const { arrayBuffer } = await expose<typeof value>({}, { transport })
  const newHash = await hashToHex(arrayBuffer)
  expect(newHash).to.equal(originalHash)
}

export const userTypedArray = async (transport: Transport) => {
  const _arrayBuffer = new ArrayBuffer(100)
  const _uint8Array = new Uint8Array(_arrayBuffer)
  crypto.getRandomValues(_uint8Array)
  const originalHash = await hashToHex(_arrayBuffer)
  const value = {
    uint8Array: _uint8Array
  }
  expose(value, { transport })

  const { uint8Array } = await expose<typeof value>({}, { transport })
  expect(uint8Array).to.be.instanceOf(Uint8Array)
  const newHash = await hashToHex(uint8Array)
  expect(newHash).to.equal(originalHash)
}

export const userReadableStream = async (transport: Transport) => {
  const _arrayBuffer = new ArrayBuffer(100)
  const uint8Array = new Uint8Array(_arrayBuffer)
  crypto.getRandomValues(uint8Array)
  const originalHash = await hashToHex(_arrayBuffer)
  const readableStream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(uint8Array)
      controller.close()
    }
  })
  const value = {
    readableStream
  }
  expose(value, { transport })

  const { readableStream: resultReadableStream } = await expose<typeof value>({}, { transport })
  expect(resultReadableStream).to.be.instanceOf(ReadableStream)
  const reader = resultReadableStream.getReader()
  const result = await reader.read()
  if (!result.value) throw new Error('value is undefined')
  const newHash = await hashToHex(result.value.buffer as ArrayBuffer)
  expect(newHash).to.equal(originalHash)
  expect(result.done).to.be.false
  const doneResult = await reader.read()
  expect(doneResult.done).to.be.true
}

export const userPromiseTypedArray = async (transport: Transport) => {
  const _arrayBuffer = new ArrayBuffer(100)
  const _uint8Array = new Uint8Array(_arrayBuffer)
  crypto.getRandomValues(_uint8Array)
  const originalHash = await hashToHex(_arrayBuffer)
  const value = {
    uint8Array: Promise.resolve(_uint8Array)
  }
  expose(value, { transport })

  const { uint8Array } = await expose<typeof value>({}, { transport })
  expect(uint8Array).to.be.instanceOf(Promise)
  const newHash = await hashToHex(await uint8Array)
  expect(newHash).to.equal(originalHash)
}

export const userDate = async (transport: Transport) => {
  const _date = new Date()
  const value = {
    date: _date
  }
  expose(value, { transport })

  const { date } = await expose<typeof value>({}, { transport })

  // Test that the date is correctly transferred
  expect(date).to.be.instanceOf(Date)
  expect(date.toISOString()).to.equal(_date.toISOString())
}

export const userError = async (transport: Transport) => {
  const _error = new Error('Test error message')
  const value = {
    error: _error,
    throwError: () => {
      throw new Error('Thrown error')
    }
  }
  expose(value, { transport })

  const { error, throwError } = await expose<typeof value>({}, { transport })

  expect(error).to.be.instanceOf(Error)
  expect(error.message).to.equal('Test error message')
  await expect(throwError()).to.be.rejectedWith('Thrown error')
}


export const asyncInit = async (transport: Transport) => {
  const value = {
    foo: 1
  }
  expose(value, { transport })
  
  await new Promise(resolve => setTimeout(resolve, 100))

  const { foo } = await expose<typeof value>({}, { transport })

  expect(foo).to.equal(1)
}

// export const userWritableStream = async (transport: Transport) => {
//   const writableStream = new WritableStream({
//     write(chunk) {
//       expect(chunk).to.deep.equal(new Uint8Array([1, 2, 3]))
//     }
//   })
//   const value = {
//     writableStream
//   }
//   expose(value, { transport })

//   const { writableStream: resultWritableStream } = await expose<typeof value>({}, { transport })
//   resultWritableStream.write(new Uint8Array([1, 2, 3]))
// }

export const userAbortSignal = async (transport: Transport) => {
  const controller = new AbortController()
  const value = {
    signal: controller.signal
  }
  expose(value, { transport })

  const { signal } = await expose<typeof value>({}, { transport })

  expect(signal).to.be.instanceOf(AbortSignal)
  expect(signal.aborted).to.be.false

  let abortedReason: unknown
  signal.addEventListener('abort', () => {
    abortedReason = signal.reason
  })

  controller.abort('test reason')

  // Wait for the abort to propagate
  await new Promise(resolve => setTimeout(resolve, 50))

  expect(signal.aborted).to.be.true
  expect(abortedReason).to.equal('test reason')
}

export const userAbortSignalAlreadyAborted = async (transport: Transport) => {
  const controller = new AbortController()
  controller.abort('pre-aborted')
  const value = {
    signal: controller.signal
  }
  expose(value, { transport })

  const { signal } = await expose<typeof value>({}, { transport })

  expect(signal).to.be.instanceOf(AbortSignal)
  expect(signal.aborted).to.be.true
}

export const userResponse = async (transport: Transport) => {
  const _response = new Response('test body', {
    status: 201,
    statusText: 'Created',
    headers: { 'X-Custom': 'header-value' }
  })
  const value = {
    response: _response
  }
  expose(value, { transport })

  const { response } = await expose<typeof value>({}, { transport })

  expect(response).to.be.instanceOf(Response)
  expect(response.status).to.equal(201)
  expect(response.statusText).to.equal('Created')
  expect(response.headers.get('X-Custom')).to.equal('header-value')

  const body = await response.text()
  expect(body).to.equal('test body')
}

export const userResponseWithStreamBody = async (transport: Transport) => {
  const chunks = ['chunk1', 'chunk2', 'chunk3']
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(new TextEncoder().encode(chunk))
      }
      controller.close()
    }
  })
  const _response = new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/plain' }
  })
  const value = {
    response: _response
  }
  expose(value, { transport })

  const { response } = await expose<typeof value>({}, { transport })

  expect(response).to.be.instanceOf(Response)
  expect(response.status).to.equal(200)

  const body = await response.text()
  expect(body).to.equal('chunk1chunk2chunk3')
}

export const userResponseNoBody = async (transport: Transport) => {
  const _response = new Response(null, {
    status: 204,
    statusText: 'No Content'
  })
  const value = {
    response: _response
  }
  expose(value, { transport })

  const { response } = await expose<typeof value>({}, { transport })

  expect(response).to.be.instanceOf(Response)
  expect(response.status).to.equal(204)
  expect(response.statusText).to.equal('No Content')
  expect(response.body).to.be.null
}

export const userRequest = async (transport: Transport) => {
  const _request = new Request('https://example.com/api', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Custom': 'test' }
  })
  const value = {
    request: _request
  }
  expose(value, { transport })

  const { request } = await expose<typeof value>({}, { transport })

  expect(request).to.be.instanceOf(Request)
  expect(request.method).to.equal('POST')
  expect(request.url).to.equal('https://example.com/api')
  expect(request.headers.get('Content-Type')).to.equal('application/json')
  expect(request.headers.get('X-Custom')).to.equal('test')
}

export const userRequestWithBody = async (transport: Transport) => {
  const bodyContent = 'test request body'
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(bodyContent))
      controller.close()
    }
  })
  const _request = new Request('https://example.com/api', {
    method: 'POST',
    body: stream,
    headers: { 'Content-Type': 'text/plain' },
    // @ts-expect-error - duplex is required for streaming bodies
    duplex: 'half'
  })
  const value = {
    request: _request
  }
  expose(value, { transport })

  const { request } = await expose<typeof value>({}, { transport })

  expect(request).to.be.instanceOf(Request)
  expect(request.method).to.equal('POST')
  expect(request.headers.get('Content-Type')).to.equal('text/plain')

  const body = await request.text()
  expect(body).to.equal(bodyContent)
}

export const userRequestNoBody = async (transport: Transport) => {
  const _request = new Request('https://example.com/resource', {
    method: 'GET'
  })
  const value = {
    request: _request
  }
  expose(value, { transport })

  const { request } = await expose<typeof value>({}, { transport })

  expect(request).to.be.instanceOf(Request)
  expect(request.method).to.equal('GET')
  expect(request.url).to.equal('https://example.com/resource')
  expect(request.body).to.be.null
}

export const userMap = async (transport: Transport) => {
  const _map = new Map<string, number>([['a', 1], ['b', 2], ['c', 3]])
  const value = { map: _map }
  expose(value, { transport })

  const { map } = await expose<typeof value>({}, { transport })

  expect(map).to.be.instanceOf(Map)
  expect(map.size).to.equal(3)
  expect(map.get('a')).to.equal(1)
  expect(map.get('b')).to.equal(2)
  expect(map.get('c')).to.equal(3)
}

export const userMapEmpty = async (transport: Transport) => {
  const value = { map: new Map<string, number>() }
  expose(value, { transport })

  const { map } = await expose<typeof value>({}, { transport })

  expect(map).to.be.instanceOf(Map)
  expect(map.size).to.equal(0)
}

export const userMapWithLiveValues = async (transport: Transport) => {
  const value = {
    map: new Map<string, Promise<number>>([
      ['first', Promise.resolve(10)],
      ['second', Promise.resolve(20)],
    ]),
  }
  expose(value, { transport })

  const { map } = await expose<typeof value>({}, { transport })

  expect(map).to.be.instanceOf(Map)
  expect(map.size).to.equal(2)
  await expect(map.get('first')!).to.eventually.equal(10)
  await expect(map.get('second')!).to.eventually.equal(20)
}

export const userMapWithFunctions = async (transport: Transport) => {
  const value = {
    map: new Map<string, () => Promise<number>>([
      ['double', async () => 4],
      ['triple', async () => 9],
    ]),
  }
  expose(value, { transport })

  const { map } = await expose<typeof value>({}, { transport })

  expect(map).to.be.instanceOf(Map)
  await expect(map.get('double')!()).to.eventually.equal(4)
  await expect(map.get('triple')!()).to.eventually.equal(9)
}

export const userMapWithComplexKeys = async (transport: Transport) => {
  const d1 = new Date('2026-01-01T00:00:00.000Z')
  const d2 = new Date('2026-06-01T00:00:00.000Z')
  const value = {
    map: new Map<Date, string>([[d1, 'jan'], [d2, 'jun']]),
  }
  expose(value, { transport })

  const { map } = await expose<typeof value>({}, { transport })

  expect(map).to.be.instanceOf(Map)
  expect(map.size).to.equal(2)
  // Keys are revived as fresh Date instances; look them up by ISOString match.
  const entries = [...map.entries()]
  const jan = entries.find(([k]) => k.toISOString() === d1.toISOString())
  const jun = entries.find(([k]) => k.toISOString() === d2.toISOString())
  expect(jan?.[1]).to.equal('jan')
  expect(jun?.[1]).to.equal('jun')
}

export const userSet = async (transport: Transport) => {
  const value = { set: new Set<number>([1, 2, 3]) }
  expose(value, { transport })

  const { set } = await expose<typeof value>({}, { transport })

  expect(set).to.be.instanceOf(Set)
  expect(set.size).to.equal(3)
  expect(set.has(1)).to.be.true
  expect(set.has(2)).to.be.true
  expect(set.has(3)).to.be.true
}

export const userSetEmpty = async (transport: Transport) => {
  const value = { set: new Set<number>() }
  expose(value, { transport })

  const { set } = await expose<typeof value>({}, { transport })

  expect(set).to.be.instanceOf(Set)
  expect(set.size).to.equal(0)
}

export const userSetWithLiveValues = async (transport: Transport) => {
  const value = {
    set: new Set<Promise<number>>([Promise.resolve(1), Promise.resolve(2)]),
  }
  expose(value, { transport })

  const { set } = await expose<typeof value>({}, { transport })

  expect(set).to.be.instanceOf(Set)
  expect(set.size).to.equal(2)
  const values = await Promise.all([...set])
  expect(values.sort()).to.deep.equal([1, 2])
}

export const userBigInt = async (transport: Transport) => {
  const value = { big: 9_007_199_254_740_993n }
  expose(value, { transport })

  const { big } = await expose<typeof value>({}, { transport })

  expect(typeof big).to.equal('bigint')
  expect(big).to.equal(9_007_199_254_740_993n)
}

export const userBigIntInMap = async (transport: Transport) => {
  const value = { map: new Map<string, bigint>([['big', 1_000_000_000_000_000_000n]]) }
  expose(value, { transport })

  const { map } = await expose<typeof value>({}, { transport })

  expect(map.get('big')).to.equal(1_000_000_000_000_000_000n)
}

export const userBigInt64Array = async (transport: Transport) => {
  const arr = new BigInt64Array([1n, 2n, 3n, -9_223_372_036_854_775_808n])
  const value = { arr }
  expose(value, { transport })

  const { arr: revived } = await expose<typeof value>({}, { transport })

  expect(revived).to.be.instanceOf(BigInt64Array)
  expect(revived.length).to.equal(4)
  expect(revived[0]).to.equal(1n)
  expect(revived[3]).to.equal(-9_223_372_036_854_775_808n)
}

export const userBigUint64Array = async (transport: Transport) => {
  const arr = new BigUint64Array([0n, 1n, 18_446_744_073_709_551_615n])
  const value = { arr }
  expose(value, { transport })

  const { arr: revived } = await expose<typeof value>({}, { transport })

  expect(revived).to.be.instanceOf(BigUint64Array)
  expect(revived.length).to.equal(3)
  expect(revived[2]).to.equal(18_446_744_073_709_551_615n)
}

export const userPromiseRejected = async (transport: Transport) => {
  const value = { failing: Promise.reject(new Error('boom')) }
  // Swallow the unhandledrejection on the local side — we re-reject on the wire.
  ;(value.failing as Promise<unknown>).catch(() => {})
  expose(value, { transport })

  const { failing } = await expose<typeof value>({}, { transport })

  await expect(failing).to.be.rejected
}

export const userPromiseRejectedWithString = async (transport: Transport) => {
  const value = { failing: Promise.reject('plain string reason') }
  ;(value.failing as Promise<unknown>).catch(() => {})
  expose(value, { transport })

  const { failing } = await expose<typeof value>({}, { transport })

  let caught: unknown
  try { await failing } catch (e) { caught = e }
  expect(typeof caught).to.equal('string')
  expect(caught).to.contain('plain string reason')
}

export const userAbortSignalErrorReason = async (transport: Transport) => {
  const controller = new AbortController()
  const value = { signal: controller.signal }
  expose(value, { transport })

  const { signal } = await expose<typeof value>({}, { transport })

  let abortedReason: unknown
  signal.addEventListener('abort', () => { abortedReason = signal.reason })

  controller.abort(new Error('abort cause'))
  await new Promise(resolve => setTimeout(resolve, 50))

  expect(signal.aborted).to.be.true
  expect(abortedReason).to.be.instanceOf(Error)
  expect((abortedReason as Error).message).to.equal('abort cause')
}

export const userHeadersDirect = async (transport: Transport) => {
  const _headers = new Headers({ 'X-A': '1', 'X-B': '2' })
  const value = { headers: _headers }
  expose(value, { transport })

  const { headers } = await expose<typeof value>({}, { transport })

  expect(headers).to.be.instanceOf(Headers)
  expect(headers.get('X-A')).to.equal('1')
  expect(headers.get('X-B')).to.equal('2')
}

export const userArrayBufferEmpty = async (transport: Transport) => {
  const value = { ab: new ArrayBuffer(0) }
  expose(value, { transport })

  const { ab } = await expose<typeof value>({}, { transport })

  expect(ab).to.be.instanceOf(ArrayBuffer)
  expect(ab.byteLength).to.equal(0)
}

export const userTypedArrayEmpty = async (transport: Transport) => {
  const value = { arr: new Uint8Array(0) }
  expose(value, { transport })

  const { arr } = await expose<typeof value>({}, { transport })

  expect(arr).to.be.instanceOf(Uint8Array)
  expect(arr.length).to.equal(0)
}

export const userReadableStreamMultiChunk = async (transport: Transport) => {
  const chunks = [new Uint8Array([1, 2]), new Uint8Array([3, 4]), new Uint8Array([5, 6])]
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk)
      controller.close()
    },
  })
  const value = { stream }
  expose(value, { transport })

  const { stream: revived } = await expose<typeof value>({}, { transport })
  const reader = revived.getReader()
  const received: number[] = []
  while (true) {
    const { value: v, done } = await reader.read()
    if (done) break
    received.push(...v)
  }
  expect(received).to.deep.equal([1, 2, 3, 4, 5, 6])
}

export const userReadableStreamCancel = async (transport: Transport) => {
  let pulled = 0
  let cancelled = false
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulled++
      controller.enqueue(new Uint8Array([pulled]))
    },
    cancel() {
      cancelled = true
    },
  })
  const value = { stream }
  expose(value, { transport })

  const { stream: revived } = await expose<typeof value>({}, { transport })
  const reader = revived.getReader()
  const first = await reader.read()
  expect(first.value?.[0]).to.equal(1)
  await reader.cancel()
  // Cancel must propagate back to the source so it can release resources.
  // Allow extra time for the JSON-transport portId roundtrip.
  for (let i = 0; i < 20 && !cancelled; i++) {
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  expect(cancelled).to.be.true
}

export const userErrorWithCause = async (transport: Transport) => {
  const inner = new Error('inner reason')
  const value = { error: new Error('outer message', { cause: inner }) }
  expose(value, { transport })

  const { error } = await expose<typeof value>({}, { transport })

  expect(error).to.be.instanceOf(Error)
  expect(error.message).to.equal('outer message')
}

export const userPromiseOfMap = async (transport: Transport) => {
  const value = {
    deferredMap: Promise.resolve(new Map<string, number>([['a', 1], ['b', 2]])),
  }
  expose(value, { transport })

  const { deferredMap } = await expose<typeof value>({}, { transport })

  const m = await deferredMap
  expect(m).to.be.instanceOf(Map)
  expect(m.get('a')).to.equal(1)
  expect(m.get('b')).to.equal(2)
}

export const userCallbackReturningSet = async (transport: Transport) => {
  const value = async () => new Set<Date>([
    new Date('2026-01-01T00:00:00.000Z'),
    new Date('2026-12-31T00:00:00.000Z'),
  ])
  expose(value, { transport })

  const remote = await expose<typeof value>({}, { transport })

  const s = await remote()
  expect(s).to.be.instanceOf(Set)
  expect(s.size).to.equal(2)
  for (const d of s) expect(d).to.be.instanceOf(Date)
}

export const userMapInsideArray = async (transport: Transport) => {
  const value = {
    list: [
      new Map<string, number>([['x', 1]]),
      new Map<string, number>([['y', 2]]),
    ],
  }
  expose(value, { transport })

  const { list } = await expose<typeof value>({}, { transport })

  expect(list).to.have.length(2)
  expect(list[0]).to.be.instanceOf(Map)
  expect(list[0]!.get('x')).to.equal(1)
  expect(list[1]!.get('y')).to.equal(2)
}

export const userArrayBufferInMap = async (transport: Transport) => {
  const buf = new Uint8Array([1, 2, 3, 4]).buffer as ArrayBuffer
  const value = {
    map: new Map<string, ArrayBuffer>([['data', buf]]),
  }
  expose(value, { transport })

  const { map } = await expose<typeof value>({}, { transport })

  const revived = map.get('data')!
  expect(revived).to.be.instanceOf(ArrayBuffer)
  expect(new Uint8Array(revived)).to.deep.equal(new Uint8Array([1, 2, 3, 4]))
}

export const base = {
  argsAndResponse,
  callback,
  callbackAsArg,
  objectBaseArgsAndResponse,
  objectCallback,
  objectCallbackAsArg,
  userMessagePort,
  userPromise,
  userArrayBuffer,
  userTypedArray,
  userReadableStream,
  userPromiseTypedArray,
  userDate,
  userError,
  asyncInit,
  userAbortSignal,
  userAbortSignalAlreadyAborted,
  userResponse,
  userResponseWithStreamBody,
  userResponseNoBody,
  userRequest,
  userRequestWithBody,
  userRequestNoBody,
  userMap,
  userMapEmpty,
  userMapWithLiveValues,
  userMapWithFunctions,
  userMapWithComplexKeys,
  userSet,
  userSetEmpty,
  userSetWithLiveValues,
  userBigInt,
  userBigIntInMap,
  userBigInt64Array,
  userBigUint64Array,
  userPromiseRejected,
  userPromiseRejectedWithString,
  userAbortSignalErrorReason,
  userHeadersDirect,
  userArrayBufferEmpty,
  userTypedArrayEmpty,
  userReadableStreamMultiChunk,
  userReadableStreamCancel,
  userErrorWithCause,
  userPromiseOfMap,
  userCallbackReturningSet,
  userMapInsideArray,
  userArrayBufferInMap,
}

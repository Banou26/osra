import type { Transport } from '../../src/types'

import { expose } from '../../src/index'

export const DEFAULT_ITERATIONS = 100000

export const functionCallsNoLeak = async (transport: Transport, iterations = DEFAULT_ITERATIONS) => {
  const value = async (data: { foo: number }, bar: string) => data.foo + bar.length
  expose(value, { transport })
  const remote = await expose<typeof value>({}, { transport })
  for (let i = 0; i < iterations; i++) {
    await remote({ foo: 1 }, 'test')
  }
}

export const callbacksNoLeak = async (transport: Transport, iterations = DEFAULT_ITERATIONS) => {
  const value = async () => async () => 1
  expose(value, { transport })
  const remote = await expose<typeof value>({}, { transport })
  for (let i = 0; i < iterations; i++) {
    const callback = await remote()
    await callback()
  }
}

export const callbackAsArgNoLeak = async (transport: Transport, iterations = DEFAULT_ITERATIONS) => {
  const value = async (callback: () => number) => callback()
  expose(value, { transport })
  const remote = await expose<typeof value>({}, { transport })
  for (let i = 0; i < iterations; i++) {
    await remote(() => 42)
  }
}

export const promiseValuesNoLeak = async (transport: Transport, iterations = DEFAULT_ITERATIONS) => {
  const value = { promise: Promise.resolve(42) }
  expose(value, { transport })
  const { promise } = await expose<typeof value>({}, { transport })
  for (let i = 0; i < iterations; i++) {
    await promise
  }
}

export const objectMethodsNoLeak = async (transport: Transport, iterations = DEFAULT_ITERATIONS) => {
  const value = {
    add: async (a: number, b: number) => a + b,
    multiply: async (a: number, b: number) => a * b
  }
  expose(value, { transport })
  const remote = await expose<typeof value>({}, { transport })
  for (let i = 0; i < iterations; i++) {
    await remote.add(1, 2)
    await remote.multiply(3, 4)
  }
}

export const largeDataTransferNoLeak = async (transport: Transport, iterations = DEFAULT_ITERATIONS) => {
  const value = async (data: Uint8Array) => data.length
  expose(value, { transport })
  const remote = await expose<typeof value>({}, { transport })
  for (let i = 0; i < iterations; i++) {
    const largeBuffer = new Uint8Array(100 * 1024) // 100KB
    await remote(largeBuffer)
  }
}

export const rapidConnectionNoLeak = async (transport: Transport, iterations = DEFAULT_ITERATIONS) => {
  const value = async () => 'connected'
  expose(value, { transport })
  const remote = await expose<typeof value>({}, { transport })
  for (let i = 0; i < iterations; i++) {
    await remote()
  }
}

export const errorHandlingNoLeak = async (transport: Transport, iterations = DEFAULT_ITERATIONS) => {
  const value = async (shouldThrow: boolean) => {
    if (shouldThrow) throw new Error('Test error')
    return 'success'
  }
  expose(value, { transport })
  const remote = await expose<typeof value>({}, { transport })
  for (let i = 0; i < iterations; i++) {
    await remote(false)
    try { await remote(true) } catch { /* Expected */ }
  }
}

export const nestedCallbacksNoLeak = async (transport: Transport, iterations = DEFAULT_ITERATIONS) => {
  const value = async (callback: (innerCb: () => number) => number) => callback(() => 42)
  expose(value, { transport })
  const remote = await expose<typeof value>({}, { transport })
  for (let i = 0; i < iterations; i++) {
    await remote((innerCb) => innerCb() * 2)
  }
}

export const concurrentCallsNoLeak = async (transport: Transport, iterations = DEFAULT_ITERATIONS) => {
  const value = async (id: number) => id * 2
  expose(value, { transport })
  const remote = await expose<typeof value>({}, { transport })
  for (let i = 0; i < iterations; i++) {
    await Promise.all([remote(1), remote(2), remote(3), remote(4), remote(5)])
  }
}

export const baseMemory = {
  DEFAULT_ITERATIONS,
  functionCallsNoLeak,
  callbacksNoLeak,
  callbackAsArgNoLeak,
  promiseValuesNoLeak,
  objectMethodsNoLeak,
  largeDataTransferNoLeak,
  rapidConnectionNoLeak,
  errorHandlingNoLeak,
  nestedCallbacksNoLeak,
  concurrentCallsNoLeak
}

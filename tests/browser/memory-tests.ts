import { expose } from '../../src/index'

export const config = {
  iterations: 100000,
  memoryTreshold: 1_000_000,
  timeout: 60_000
}

export const functionCallsNoLeak = async () => {
  const value = async (data: { foo: number }, bar: string) => data.foo + bar.length
  expose(value, { transport: window })
  const remote = await expose<typeof value>({}, { transport: window })
  for (let i = 0; i < config.iterations; i++) {
    await remote({ foo: 1 }, 'test')
  }
}

export const callbacksNoLeak = async () => {
  const value = async () => async () => 1
  expose(value, { transport: window })
  const remote = await expose<typeof value>({}, { transport: window })
  for (let i = 0; i < config.iterations; i++) {
    const callback = await remote()
    await callback()
  }
}

export const callbackAsArgNoLeak = async () => {
  const value = async (callback: () => number) => callback()
  expose(value, { transport: window })
  const remote = await expose<typeof value>({}, { transport: window })
  for (let i = 0; i < config.iterations; i++) {
    await remote(() => 42)
  }
}

export const promiseValuesNoLeak = async () => {
  const value = { promise: Promise.resolve(42) }
  expose(value, { transport: window })
  const { promise } = await expose<typeof value>({}, { transport: window })
  for (let i = 0; i < config.iterations; i++) {
    await promise
  }
}

export const objectMethodsNoLeak = async () => {
  const value = {
    add: async (a: number, b: number) => a + b,
    multiply: async (a: number, b: number) => a * b
  }
  expose(value, { transport: window })
  const remote = await expose<typeof value>({}, { transport: window })
  for (let i = 0; i < config.iterations; i++) {
    await remote.add(1, 2)
    await remote.multiply(3, 4)
  }
}

export const largeDataTransferNoLeak = async () => {
  const value = async (data: Uint8Array) => data.length
  expose(value, { transport: window })
  const remote = await expose<typeof value>({}, { transport: window })
  for (let i = 0; i < config.iterations; i++) {
    const largeBuffer = new Uint8Array(100 * 1024) // 100KB
    await remote(largeBuffer)
  }
}

export const rapidConnectionNoLeak = async () => {
  const value = async () => 'connected'
  expose(value, { transport: window })
  const remote = await expose<typeof value>({}, { transport: window })
  for (let i = 0; i < config.iterations; i++) {
    await remote()
  }
}

export const errorHandlingNoLeak = async () => {
  const value = async (shouldThrow: boolean) => {
    if (shouldThrow) throw new Error('Test error')
    return 'success'
  }
  expose(value, { transport: window })
  const remote = await expose<typeof value>({}, { transport: window })
  for (let i = 0; i < config.iterations; i++) {
    await remote(false)
    try { await remote(true) } catch { /* Expected */ }
  }
}

export const nestedCallbacksNoLeak = async () => {
  const value = async (callback: (innerCb: () => number) => number) => callback(() => 42)
  expose(value, { transport: window })
  const remote = await expose<typeof value>({}, { transport: window })
  for (let i = 0; i < config.iterations; i++) {
    await remote((innerCb) => innerCb() * 2)
  }
}

export const concurrentCallsNoLeak = async () => {
  const value = async (id: number) => id * 2
  expose(value, { transport: window })
  const remote = await expose<typeof value>({}, { transport: window })
  for (let i = 0; i < config.iterations; i++) {
    await Promise.all([remote(1), remote(2), remote(3), remote(4), remote(5)])
  }
}

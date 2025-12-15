import { expose } from '../../src/index'

const api = {
  echo: async <T>(data: T): Promise<T> => data,
  add: async (a: number, b: number) => a + b,
  math: {
    multiply: async (a: number, b: number) => a * b,
    divide: async (a: number, b: number) => a / b
  },
  createCallback: async () => async () => 42,
  callWithCallback: async (cb: () => number) => cb(),
  getDate: async () => new Date(),
  getError: async () => new Error('Test error'),
  throwError: async (): Promise<never> => { throw new Error('Thrown error') },
  processBuffer: async (data: Uint8Array) => new Uint8Array(data.map(x => x * 2)),
  getBuffer: async () => {
    const buffer = new ArrayBuffer(16)
    new Uint8Array(buffer).forEach((_, i, arr) => arr[i] = i)
    return buffer
  },
  getPromise: async () => Promise.resolve(123),
  getStream: async () => new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3]))
      controller.enqueue(new Uint8Array([4, 5, 6]))
      controller.close()
    }
  })
}

export type TestAPI = typeof api

const jsonOnlyCapabilities = {
  jsonOnly: true,
  messagePort: false,
  arrayBuffer: false,
  transferable: false,
  transferableStream: false
}

chrome.runtime.onConnect.addListener((port) => {
  expose(api, {
    transport: { isJson: true, emit: port, receive: port },
    platformCapabilities: jsonOnlyCapabilities
  })
})

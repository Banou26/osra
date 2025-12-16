import { expose } from '../../src/index'
import type { ContentAPI, TestAPI } from './types'

const jsonOnlyCapabilities = {
  jsonOnly: true,
  messagePort: false,
  arrayBuffer: false,
  transferable: false,
  transferableStream: false
}

// Store content API reference for background->content calls
let contentApi: ContentAPI | null = null

const api: TestAPI = {
  // Original background API (content->background)
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
  }),

  // Background->Content wrapper methods (for testing background->content calls)
  bgToContent: {
    getInfo: async () => {
      if (!contentApi) throw new Error('Content not connected')
      return contentApi.getContentInfo()
    },
    process: async (data: string) => {
      if (!contentApi) throw new Error('Content not connected')
      return contentApi.processInContent(data)
    },
    getCallback: async () => {
      if (!contentApi) throw new Error('Content not connected')
      return contentApi.contentCallback()
    },
    getDate: async () => {
      if (!contentApi) throw new Error('Content not connected')
      return contentApi.getContentDate()
    },
    getError: async () => {
      if (!contentApi) throw new Error('Content not connected')
      return contentApi.getContentError()
    },
    throwError: async () => {
      if (!contentApi) throw new Error('Content not connected')
      return contentApi.throwContentError()
    },
    processBuffer: async (data: Uint8Array) => {
      if (!contentApi) throw new Error('Content not connected')
      return contentApi.processContentBuffer(data)
    },
  }
}

chrome.runtime.onConnect.addListener(async (port) => {
  contentApi = await expose<ContentAPI, TestAPI>(api, {
    transport: { isJson: true, emit: port, receive: port },
    platformCapabilities: jsonOnlyCapabilities
  })
})

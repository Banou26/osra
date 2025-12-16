import { expose } from '../../src/index'
import type { ContentAPI, TestAPI } from './types'

const jsonOnlyCapabilities = {
  jsonOnly: true,
  messagePort: false,
  arrayBuffer: false,
  transferable: false,
  transferableStream: false
}

// Content API from content-initiated connection
let contentApi: ContentAPI | null = null
// Content API from background-initiated connection
let bgInitiatedContentApi: ContentAPI | null = null
// Tab ID from the content-initiated connection (for background-initiated connection)
let connectedTabId: number | null = null

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

  // Background->Content via content-initiated connection
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
  },

  // Background-initiated connection methods
  bgInitiated: {
    connect: async () => {
      if (!connectedTabId) throw new Error('No tab connected yet')
      const port = chrome.tabs.connect(connectedTabId, { name: `bg-to-content-${Date.now()}` })
      bgInitiatedContentApi = await expose<ContentAPI, TestAPI>(api, {
        transport: { isJson: true, emit: port, receive: port },
        platformCapabilities: jsonOnlyCapabilities
      })
      return true
    },
    getInfo: async () => {
      if (!bgInitiatedContentApi) throw new Error('Background-initiated connection not established')
      return bgInitiatedContentApi.getContentInfo()
    },
    process: async (data: string) => {
      if (!bgInitiatedContentApi) throw new Error('Background-initiated connection not established')
      return bgInitiatedContentApi.processInContent(data)
    },
    getCallback: async () => {
      if (!bgInitiatedContentApi) throw new Error('Background-initiated connection not established')
      return bgInitiatedContentApi.contentCallback()
    },
    getDate: async () => {
      if (!bgInitiatedContentApi) throw new Error('Background-initiated connection not established')
      return bgInitiatedContentApi.getContentDate()
    },
    getError: async () => {
      if (!bgInitiatedContentApi) throw new Error('Background-initiated connection not established')
      return bgInitiatedContentApi.getContentError()
    },
    throwError: async () => {
      if (!bgInitiatedContentApi) throw new Error('Background-initiated connection not established')
      return bgInitiatedContentApi.throwContentError()
    },
    processBuffer: async (data: Uint8Array) => {
      if (!bgInitiatedContentApi) throw new Error('Background-initiated connection not established')
      return bgInitiatedContentApi.processContentBuffer(data)
    },
  }
}

// Listen for content-initiated and popup connections
chrome.runtime.onConnect.addListener(async (port) => {
  if (port.name.startsWith('content-')) {
    // Track the tab ID for background-initiated connections
    connectedTabId = port.sender?.tab?.id ?? null
    contentApi = await expose<ContentAPI, typeof api>(api, {
      transport: { isJson: true, emit: port, receive: port },
      platformCapabilities: jsonOnlyCapabilities
    })
  } else if (port.name.startsWith('popup-')) {
    // Handle popup connections (unidirectional - popup only calls background)
    await expose<void, typeof api>(api, {
      transport: { isJson: true, emit: port, receive: port },
      platformCapabilities: jsonOnlyCapabilities
    })
  }
})

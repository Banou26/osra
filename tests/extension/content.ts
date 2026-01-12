import { Resolvers as BackgroundResolvers } from './background'

import { expose } from '../../src/index'
import * as contentTests from './content-tests'
import { setApi, setBgInitiatedApi } from './content-tests'

const jsonOnlyCapabilities = {
  jsonOnly: true,
  messagePort: false,
  arrayBuffer: false,
  transferable: false,
  transferableStream: false
}

// API exposed by content script to background
const resolvers = {
  getContentInfo: async () => ({ location: window.location.href, timestamp: Date.now() }),
  processInContent: async (data: string) => `content-processed: ${data}`,
  contentCallback: async () => async () => 'from-content-callback',
  getContentDate: async () => new Date(),
  getContentError: async () => new Error('Content error'),
  throwContentError: async (): Promise<never> => { throw new Error('Content thrown') },
  processContentBuffer: async (data: Uint8Array) => new Uint8Array(data.map(x => x + 1)),
}

export type Resolvers = typeof resolvers

// Content-initiated connection to background
const port = chrome.runtime.connect({ name: `content-${Date.now()}` })
const api = await expose<BackgroundResolvers>(resolvers, {
  transport: { isJson: true, emit: port, receive: port },
  platformCapabilities: jsonOnlyCapabilities
})

setApi(api)

// Listen for background-initiated connections
chrome.runtime.onConnect.addListener(async (port) => {
  if (port.name.startsWith('bg-to-content-')) {
    const bgInitiatedApi = await expose<BackgroundResolvers>(resolvers, {
      transport: { isJson: true, emit: port, receive: port },
      platformCapabilities: jsonOnlyCapabilities
    })
    setBgInitiatedApi(bgInitiatedApi)
  }
})

globalThis.tests = { Content: contentTests }

// Event-based test runner for Vitest browser mode
// Listen for test requests from the page and respond with results
window.addEventListener('osra-test-request', async (event) => {
  const { testName, requestId } = (event as CustomEvent).detail

  try {
    const testFn = (contentTests as Record<string, () => Promise<void>>)[testName]
    if (typeof testFn !== 'function') {
      throw new Error(`Test "${testName}" not found`)
    }

    await testFn()

    // Send success response
    window.dispatchEvent(new CustomEvent('osra-test-response', {
      detail: { requestId, success: true }
    }))
  } catch (error) {
    // Send error response
    window.dispatchEvent(new CustomEvent('osra-test-response', {
      detail: {
        requestId,
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }))
  }
})

// Signal that the content script is ready
window.dispatchEvent(new CustomEvent('osra-content-ready'))

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

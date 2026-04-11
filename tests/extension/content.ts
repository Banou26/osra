import { Resolvers as BackgroundResolvers } from './background'

import { expose } from '../../src/index'
import * as contentTests from './content-tests'
import { setApi, setBgInitiatedApi } from './content-tests'

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
  transport: { isJson: true, emit: port, receive: port }
})

setApi(api)

// Listen for background-initiated connections
chrome.runtime.onConnect.addListener(async (port) => {
  if (port.name.startsWith('bg-to-content-')) {
    const bgInitiatedApi = await expose<BackgroundResolvers>(resolvers, {
      transport: { isJson: true, emit: port, receive: port }
    })
    setBgInitiatedApi(bgInitiatedApi)
  }
})

// Runtime transport connection (sendMessage-based, alongside the port-based one)
import * as runtimeContentTests from './runtime-content-tests'
import { setApi as setRuntimeApi } from './runtime-content-tests'

const runtimeTransport = {
  isJson: true,
  emit: (message: any) => chrome.runtime.sendMessage(message),
  receive: (listener: (message: any, context: any) => void) => {
    chrome.runtime.onMessage.addListener((message: any, sender: any) => {
      listener(message, { sender })
    })
  }
}

const runtimeApi = await expose<BackgroundResolvers>(resolvers, {
  transport: runtimeTransport
})

setRuntimeApi(runtimeApi)

globalThis.tests = { Content: contentTests, RuntimeContent: runtimeContentTests }

import { expose } from '../../src/index'
import type { TestAPI } from './background'
import * as contentTests from './content-tests'
import { setApi } from './content-tests'

const jsonOnlyCapabilities = {
  jsonOnly: true,
  messagePort: false,
  arrayBuffer: false,
  transferable: false,
  transferableStream: false
}

const port = chrome.runtime.connect({ name: `content-${Date.now()}` })
const api = await expose<TestAPI>({}, {
  transport: { isJson: true, emit: port, receive: port },
  platformCapabilities: jsonOnlyCapabilities
})

setApi(api)

const tests = { Content: contentTests }
globalThis.tests = tests

type TestObject = {
  [key: string]: TestObject | ((...args: any[]) => any)
}

const findTest = (path: string[], key: string): (() => Promise<void>) | undefined => {
  const obj = path.reduce((obj, k) => (obj as TestObject)?.[k], tests as TestObject)
  return (obj as TestObject)?.[key] as (() => Promise<void>) | undefined
}

window.addEventListener('message', async (event) => {
  if (event.source !== window) return

  if (event.data?.type === 'OSRA_RUN_TEST') {
    const { key, path, id } = event.data as { key: string; path: string[]; id: string }
    try {
      const test = findTest(path, key)
      if (!test) {
        throw new Error(`Test not found: ${[...path, key].join('.')}`)
      }
      await test()
      window.postMessage({ type: 'OSRA_TEST_RESULT', id, success: true }, '*')
    } catch (error) {
      window.postMessage({
        type: 'OSRA_TEST_RESULT',
        id,
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }, '*')
    }
  }

  if (event.data?.type === 'OSRA_PING') {
    window.postMessage({ type: 'OSRA_PONG' }, '*')
  }
})

window.postMessage({ type: 'OSRA_CONTENT_READY' }, '*')

console.log('content script')

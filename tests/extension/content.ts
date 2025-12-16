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

globalThis.tests = { Content: contentTests }

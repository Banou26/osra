import { expose } from '../../src/index'
import type { TestAPI } from './types'
import * as popupTests from './popup-tests'
import { setApi } from './popup-tests'

const jsonOnlyCapabilities = {
  jsonOnly: true,
  messagePort: false,
  arrayBuffer: false,
  transferable: false,
  transferableStream: false
}

const port = chrome.runtime.connect({ name: `popup-${Date.now()}` })
const api = await expose<TestAPI>({}, {
  transport: { isJson: true, emit: port, receive: port },
  platformCapabilities: jsonOnlyCapabilities
})

setApi(api)

globalThis.tests = { Popup: popupTests }

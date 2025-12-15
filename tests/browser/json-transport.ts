import type { Transport } from '../../src/types'

import { base } from './base-tests'

const jsonTransport = (): Transport => ({
  isJson: true,
  receive: (listener) => {
    window.addEventListener('message', event => {
      const data = JSON.parse(event.data)
      listener(data, {})
    })
  },
  emit: async (message) => {
    window.postMessage(JSON.stringify(message))
  }
})

export const argsAndResponse = () => base.argsAndResponse(jsonTransport())

export const callback = () => base.callback(jsonTransport())

export const callbackAsArg = () => base.callbackAsArg(jsonTransport())

export const objectBaseArgsAndResponse = () => base.objectBaseArgsAndResponse(jsonTransport())

export const objectCallback = () => base.objectCallback(jsonTransport())

export const objectCallbackAsArg = () => base.objectCallbackAsArg(jsonTransport())

export const userMessagePort = () => base.userMessagePort(jsonTransport())

export const userPromise = () => base.userPromise(jsonTransport())

export const userArrayBuffer = () => base.userArrayBuffer(jsonTransport())

export const userTypedArray = () => base.userTypedArray(jsonTransport())

export const userReadableStream = () => base.userReadableStream(jsonTransport())

export const userPromiseTypedArray = () => base.userPromiseTypedArray(jsonTransport())

export const userDate = () => base.userDate(jsonTransport())

export const userError = () => base.userError(jsonTransport())

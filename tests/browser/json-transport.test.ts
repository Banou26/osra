import { describe, it } from 'vitest'
import { use } from 'chai'
import chaiAsPromised from 'chai-as-promised'
import type { Transport } from '../../src/types'
import { base } from './base-tests'

use(chaiAsPromised)

// Create an isolated JSON transport with loopback behavior
const createJsonTransport = (): Transport => {
  const listeners: ((data: any, event: any) => void)[] = []

  return {
    isJson: true,
    receive: (listener) => {
      listeners.push(listener)
    },
    emit: async (message) => {
      // Simulate JSON serialization/deserialization
      const serialized = JSON.stringify(message)
      const deserialized = JSON.parse(serialized)
      // Deliver asynchronously
      queueMicrotask(() => {
        listeners.forEach(listener => listener(deserialized, {}))
      })
    }
  }
}

describe('JSONTransport', () => {
  it('argsAndResponse', () => base.argsAndResponse(createJsonTransport()))
  it('callback', () => base.callback(createJsonTransport()))
  it('callbackAsArg', () => base.callbackAsArg(createJsonTransport()))
  it('objectBaseArgsAndResponse', () => base.objectBaseArgsAndResponse(createJsonTransport()))
  it('objectCallback', () => base.objectCallback(createJsonTransport()))
  it('objectCallbackAsArg', () => base.objectCallbackAsArg(createJsonTransport()))
  it('userMessagePort', () => base.userMessagePort(createJsonTransport()))
  it('userPromise', () => base.userPromise(createJsonTransport()))
  it('userArrayBuffer', () => base.userArrayBuffer(createJsonTransport()))
  it('userTypedArray', () => base.userTypedArray(createJsonTransport()))
  it('userReadableStream', () => base.userReadableStream(createJsonTransport()))
  it('userPromiseTypedArray', () => base.userPromiseTypedArray(createJsonTransport()))
  it('userDate', () => base.userDate(createJsonTransport()))
  it('userError', () => base.userError(createJsonTransport()))
  it('asyncInit', () => base.asyncInit(createJsonTransport()))
})

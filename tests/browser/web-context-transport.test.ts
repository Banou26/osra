import { describe, it } from 'vitest'
import { use } from 'chai'
import chaiAsPromised from 'chai-as-promised'
import type { Transport } from '../../src/types'
import { base } from './base-tests'

use(chaiAsPromised)

// Create a loopback CustomTransport that mimics window.postMessage behavior
// Uses emit/receive function interface which the library supports
const createLoopbackTransport = (): Transport => {
  const listeners: ((message: any, messageContext: any) => void)[] = []

  return {
    receive: (listener) => {
      listeners.push(listener)
    },
    emit: (message, transferables) => {
      // Deliver asynchronously like real postMessage
      queueMicrotask(() => {
        // Create a message context similar to what the library expects
        const messageContext = { ports: transferables?.filter(t => t instanceof MessagePort) }
        listeners.forEach(listener => listener(message, messageContext))
      })
    }
  }
}

describe('Web', () => {
  it('argsAndResponse', () => base.argsAndResponse(createLoopbackTransport()))
  it('callback', () => base.callback(createLoopbackTransport()))
  it('callbackAsArg', () => base.callbackAsArg(createLoopbackTransport()))
  it('objectBaseArgsAndResponse', () => base.objectBaseArgsAndResponse(createLoopbackTransport()))
  it('objectCallback', () => base.objectCallback(createLoopbackTransport()))
  it('objectCallbackAsArg', () => base.objectCallbackAsArg(createLoopbackTransport()))
  it('userMessagePort', () => base.userMessagePort(createLoopbackTransport()))
  it('userPromise', () => base.userPromise(createLoopbackTransport()))
  it('userArrayBuffer', () => base.userArrayBuffer(createLoopbackTransport()))
  it('userTypedArray', () => base.userTypedArray(createLoopbackTransport()))
  it('userReadableStream', () => base.userReadableStream(createLoopbackTransport()))
  it('userPromiseTypedArray', () => base.userPromiseTypedArray(createLoopbackTransport()))
  it('userDate', () => base.userDate(createLoopbackTransport()))
  it('userError', () => base.userError(createLoopbackTransport()))
  it('asyncInit', () => base.asyncInit(createLoopbackTransport()))
})

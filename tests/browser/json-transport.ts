import type { Transport } from '../../src/types'

import { base } from './base-tests'
import { baseMemory } from './base-memory-tests'

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

export const asyncInit = () => base.asyncInit(jsonTransport())

// JSON transport is much slower due to serialization and has higher memory overhead
// due to virtual port event listeners, so use fewer iterations and higher threshold
const JSON_ITERATIONS = 1000
const JSON_MEMORY_THRESHOLD = 10_000_000

export const MemoryLeaks = {
  config: {
    iterations: JSON_ITERATIONS,
    memoryTreshold: JSON_MEMORY_THRESHOLD,
    timeout: 60_000
  },
  functionCallsNoLeak: () => baseMemory.functionCallsNoLeak(jsonTransport(), JSON_ITERATIONS),
  callbacksNoLeak: () => baseMemory.callbacksNoLeak(jsonTransport(), JSON_ITERATIONS),
  callbackAsArgNoLeak: () => baseMemory.callbackAsArgNoLeak(jsonTransport(), JSON_ITERATIONS),
  promiseValuesNoLeak: () => baseMemory.promiseValuesNoLeak(jsonTransport(), JSON_ITERATIONS),
  objectMethodsNoLeak: () => baseMemory.objectMethodsNoLeak(jsonTransport(), JSON_ITERATIONS),
  largeDataTransferNoLeak: () => baseMemory.largeDataTransferNoLeak(jsonTransport(), JSON_ITERATIONS),
  rapidConnectionNoLeak: () => baseMemory.rapidConnectionNoLeak(jsonTransport(), JSON_ITERATIONS),
  errorHandlingNoLeak: () => baseMemory.errorHandlingNoLeak(jsonTransport(), JSON_ITERATIONS),
  nestedCallbacksNoLeak: () => baseMemory.nestedCallbacksNoLeak(jsonTransport(), JSON_ITERATIONS),
  concurrentCallsNoLeak: () => baseMemory.concurrentCallsNoLeak(jsonTransport(), JSON_ITERATIONS)
}

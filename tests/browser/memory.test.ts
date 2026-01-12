import { describe, it } from 'vitest'
import type { Transport } from '../../src/types'
import { baseMemory } from './base-memory-tests'

// Memory testing utilities
// Note: These tests use Chrome's non-standard performance.memory API

interface PerformanceMemory {
  usedJSHeapSize: number
  totalJSHeapSize: number
  jsHeapSizeLimit: number
}

declare global {
  interface Performance {
    memory?: PerformanceMemory
  }
  var gc: (() => void) | undefined
}

const getMemoryUsage = (): number | undefined => {
  return performance.memory?.usedJSHeapSize
}

const triggerGC = async () => {
  if (typeof gc === 'function') {
    gc()
  }
  await new Promise(resolve => setTimeout(resolve, 50))
  if (typeof gc === 'function') {
    gc()
  }
}

const runMemoryTest = async (
  testFn: () => Promise<void>,
  threshold: number = 1_000_000
) => {
  const initialMemory = getMemoryUsage()
  if (initialMemory === undefined) {
    console.warn('Memory API not available, skipping memory check')
    await testFn()
    return
  }

  await testFn()

  for (let i = 0; i < 5; i++) {
    await triggerGC()
  }

  const finalMemory = getMemoryUsage()
  if (finalMemory === undefined) return

  const memoryGrowth = finalMemory - initialMemory
  if (memoryGrowth > threshold) {
    throw new Error(`Memory leak detected: ${memoryGrowth} bytes growth (threshold: ${threshold})`)
  }
}

// Create a loopback CustomTransport that mimics window.postMessage behavior
const createLoopbackTransport = (): Transport => {
  const listeners: ((message: any, messageContext: any) => void)[] = []

  return {
    receive: (listener) => {
      listeners.push(listener)
    },
    emit: (message, transferables) => {
      queueMicrotask(() => {
        const messageContext = { ports: transferables?.filter(t => t instanceof MessagePort) }
        listeners.forEach(listener => listener(message, messageContext))
      })
    }
  }
}

// Reduced iterations for faster tests
const WEB_ITERATIONS = 1000
const WEB_MEMORY_THRESHOLD = 5_000_000

describe('Web MemoryLeaks', { timeout: 120_000 }, () => {
  it('functionCallsNoLeak', () =>
    runMemoryTest(() => baseMemory.functionCallsNoLeak(createLoopbackTransport(), WEB_ITERATIONS), WEB_MEMORY_THRESHOLD))

  it('callbacksNoLeak', () =>
    runMemoryTest(() => baseMemory.callbacksNoLeak(createLoopbackTransport(), WEB_ITERATIONS), WEB_MEMORY_THRESHOLD))

  it('callbackAsArgNoLeak', () =>
    runMemoryTest(() => baseMemory.callbackAsArgNoLeak(createLoopbackTransport(), WEB_ITERATIONS), WEB_MEMORY_THRESHOLD))

  it('promiseValuesNoLeak', () =>
    runMemoryTest(() => baseMemory.promiseValuesNoLeak(createLoopbackTransport(), WEB_ITERATIONS), WEB_MEMORY_THRESHOLD))

  it('objectMethodsNoLeak', () =>
    runMemoryTest(() => baseMemory.objectMethodsNoLeak(createLoopbackTransport(), WEB_ITERATIONS), WEB_MEMORY_THRESHOLD))

  it('largeDataTransferNoLeak', () =>
    runMemoryTest(() => baseMemory.largeDataTransferNoLeak(createLoopbackTransport(), WEB_ITERATIONS), WEB_MEMORY_THRESHOLD))

  it('rapidConnectionNoLeak', () =>
    runMemoryTest(() => baseMemory.rapidConnectionNoLeak(createLoopbackTransport(), WEB_ITERATIONS), WEB_MEMORY_THRESHOLD))

  it('errorHandlingNoLeak', () =>
    runMemoryTest(() => baseMemory.errorHandlingNoLeak(createLoopbackTransport(), WEB_ITERATIONS), WEB_MEMORY_THRESHOLD))

  it('nestedCallbacksNoLeak', () =>
    runMemoryTest(() => baseMemory.nestedCallbacksNoLeak(createLoopbackTransport(), WEB_ITERATIONS), WEB_MEMORY_THRESHOLD))

  it('concurrentCallsNoLeak', () =>
    runMemoryTest(() => baseMemory.concurrentCallsNoLeak(createLoopbackTransport(), WEB_ITERATIONS), WEB_MEMORY_THRESHOLD))
})

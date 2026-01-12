import { describe, it, expect, beforeAll } from 'vitest'

// Test names from content-tests.ts
const contentTests = [
  // Content -> Background tests
  'echo',
  'add',
  'mathMultiply',
  'mathDivide',
  'createCallback',
  'callWithCallback',
  'getDate',
  'getError',
  'throwError',
  'processBuffer',
  'getBuffer',
  'getPromise',
  'getStream',
  // Background -> Content tests (via content-initiated connection)
  'bgToContentGetInfo',
  'bgToContentProcess',
  'bgToContentCallback',
  'bgToContentGetDate',
  'bgToContentGetError',
  'bgToContentThrowError',
  'bgToContentProcessBuffer',
  // Background-initiated connection tests
  'bgInitiatedConnect',
  'bgInitiatedGetInfo',
  'bgInitiatedProcess',
  'bgInitiatedGetDate',
  'bgInitiatedGetError',
  'bgInitiatedThrowError',
  'bgInitiatedProcessBuffer'
]

// Helper to run a test in the content script via events
const runContentTest = (testName: string): Promise<void> => {
  return new Promise((resolve, reject) => {
    const requestId = `${testName}-${Date.now()}-${Math.random().toString(36).slice(2)}`

    const handleResponse = (event: Event) => {
      const { requestId: respId, success, error } = (event as CustomEvent).detail
      if (respId !== requestId) return

      window.removeEventListener('osra-test-response', handleResponse)

      if (success) {
        resolve()
      } else {
        reject(new Error(error || 'Test failed'))
      }
    }

    window.addEventListener('osra-test-response', handleResponse)

    // Request the content script to run the test
    window.dispatchEvent(new CustomEvent('osra-test-request', {
      detail: { testName, requestId }
    }))

    // Timeout after 5 seconds
    setTimeout(() => {
      window.removeEventListener('osra-test-response', handleResponse)
      reject(new Error(`Test "${testName}" timed out`))
    }, 5000)
  })
}

// Wait for content script to be ready
const waitForContentScript = (): Promise<void> => {
  return new Promise((resolve) => {
    // Check if already ready
    const checkReady = () => {
      // Try to dispatch a ping and see if we get a response
      const requestId = `ping-${Date.now()}`

      const handleResponse = (event: Event) => {
        const { requestId: respId } = (event as CustomEvent).detail
        if (respId === requestId) {
          window.removeEventListener('osra-test-response', handleResponse)
          resolve()
        }
      }

      window.addEventListener('osra-test-response', handleResponse)

      // Try to run a simple test to check if content script is ready
      window.dispatchEvent(new CustomEvent('osra-test-request', {
        detail: { testName: 'echo', requestId }
      }))

      // If no response in 500ms, retry
      setTimeout(() => {
        window.removeEventListener('osra-test-response', handleResponse)
        checkReady()
      }, 500)
    }

    // Also listen for the ready event
    const handleReady = () => {
      window.removeEventListener('osra-content-ready', handleReady)
      // Give it a moment to fully initialize
      setTimeout(resolve, 100)
    }

    window.addEventListener('osra-content-ready', handleReady)

    // Start checking
    setTimeout(checkReady, 100)
  })
}

describe('Extension Content Script', () => {
  beforeAll(async () => {
    // Wait for the content script to be ready
    await waitForContentScript()
  }, 30000)

  describe('Content -> Background', () => {
    it('echo', () => runContentTest('echo'))
    it('add', () => runContentTest('add'))
    it('mathMultiply', () => runContentTest('mathMultiply'))
    it('mathDivide', () => runContentTest('mathDivide'))
    it('createCallback', () => runContentTest('createCallback'))
    it('callWithCallback', () => runContentTest('callWithCallback'))
    it('getDate', () => runContentTest('getDate'))
    it('getError', () => runContentTest('getError'))
    it('throwError', () => runContentTest('throwError'))
    it('processBuffer', () => runContentTest('processBuffer'))
    it('getBuffer', () => runContentTest('getBuffer'))
    it('getPromise', () => runContentTest('getPromise'))
    it('getStream', () => runContentTest('getStream'))
  })

  describe('Background -> Content (via content-initiated connection)', () => {
    it('bgToContentGetInfo', () => runContentTest('bgToContentGetInfo'))
    it('bgToContentProcess', () => runContentTest('bgToContentProcess'))
    it('bgToContentCallback', () => runContentTest('bgToContentCallback'))
    it('bgToContentGetDate', () => runContentTest('bgToContentGetDate'))
    it('bgToContentGetError', () => runContentTest('bgToContentGetError'))
    it('bgToContentThrowError', () => runContentTest('bgToContentThrowError'))
    it('bgToContentProcessBuffer', () => runContentTest('bgToContentProcessBuffer'))
  })

  describe('Background-initiated connection', () => {
    it('bgInitiatedConnect', () => runContentTest('bgInitiatedConnect'))
    it('bgInitiatedGetInfo', () => runContentTest('bgInitiatedGetInfo'))
    it('bgInitiatedProcess', () => runContentTest('bgInitiatedProcess'))
    it('bgInitiatedGetDate', () => runContentTest('bgInitiatedGetDate'))
    it('bgInitiatedGetError', () => runContentTest('bgInitiatedGetError'))
    it('bgInitiatedThrowError', () => runContentTest('bgInitiatedThrowError'))
    it('bgInitiatedProcessBuffer', () => runContentTest('bgInitiatedProcessBuffer'))
  })
})

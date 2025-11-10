# Osra Advanced Usage Guide

## Table of Contents

1. [Protocol Modes](#protocol-modes)
2. [Transport Modes](#transport-modes)
3. [Platform Capabilities](#platform-capabilities)
4. [Complex Type Handling](#complex-type-handling)
5. [Performance Optimization](#performance-optimization)
6. [Error Handling & Debugging](#error-handling--debugging)
7. [Security Considerations](#security-considerations)
8. [Custom Transports](#custom-transports)
9. [Browser Extension Integration](#browser-extension-integration)
10. [Testing Strategies](#testing-strategies)

## Protocol Modes

Osra supports two protocol modes that determine how communication flows between contexts.

### Bidirectional Mode

In bidirectional mode, both sides can expose APIs and call each other. This creates a full-duplex communication channel.

```typescript
// worker.ts
import { expose } from 'osra'

const workerAPI = {
  processData: async (data: any, callback: Function) => {
    // Process data
    const result = await heavyComputation(data)

    // Call back to main thread
    await callback(result)

    return result
  }
}

const mainAPI = await expose<MainAPI>(workerAPI, { transport: self })

// Now worker can call main thread functions
await mainAPI.updateUI('Processing...')


// main.ts
const mainAPI = {
  updateUI: async (status: string) => {
    document.getElementById('status').textContent = status
  },

  onProgress: async (percent: number) => {
    console.log(`Progress: ${percent}%`)
  }
}

const workerAPI = await expose<WorkerAPI>(mainAPI, { transport: worker })

// Both sides can call each other
await workerAPI.processData(data, mainAPI.onProgress)
```

**Use Cases:**
- Real-time collaboration where both sides need to notify each other
- Worker needs to query main thread for DOM information
- Implementing pub/sub patterns across contexts

### Unidirectional Mode

In unidirectional mode, only one side exposes an API (server), and the other side calls it (client).

```typescript
// Server side - only exposes
expose(api, { transport })

// Client side - only calls
const api = await expose<API>({}, { transport })
```

**Advantages:**
- Simpler mental model
- Lower overhead
- Clear separation of concerns

**Detection:**
Osra automatically detects the mode based on the initial handshake. If one side sends an empty object `{}`, it's treated as unidirectional.

## Transport Modes

### Capable Mode

Capable mode uses native browser capabilities like structured cloning and transferables for optimal performance.

```typescript
// Automatically selected for most transports
const api = await expose<API>({}, { transport: worker })

// Direct transfer of complex types via structured cloning
await api.sendFunction(async () => console.log('Hello from function!'))
await api.sendPromise(Promise.resolve(42))
```

**Supported Transports:**
- Worker/SharedWorker/ServiceWorker
- MessagePort
- Window (with MessageChannel)

### JSON-Only Mode

JSON-only mode uses a box/reviver system to serialize complex types into JSON. **Complex types still work through this system.**

```typescript
// Automatically selected for WebSocket/WebExtension
const api = await expose<API>({}, { transport: websocket })

// Complex types work via box/reviver system!
await api.sendFunction(async () => console.log('This works!'))
await api.sendPromise(Promise.resolve(42))  // Works!
await api.sendDate(new Date())              // Works!
await api.sendError(new Error('test'))      // Works!

// Behind the scenes, Osra:
// 1. "Boxes" complex types into JSON-serializable format
// 2. Sends them over the JSON transport
// 3. "Revives" them on the receiving end with full functionality
```

**How It Works:**
- Functions are boxed with MessagePorts for remote execution
- Promises are boxed with MessagePorts for resolution/rejection
- Dates are boxed as ISO strings and revived as Date objects
- Errors are boxed with message/stack and revived as Error objects
- ArrayBuffers are boxed as base64 and revived as ArrayBuffers
- TypedArrays preserve their type information through boxing

**Supported Transports:**
- WebSocket
- Chrome/Firefox Extension APIs

**Force JSON-Only Mode:**
```typescript
// You can force JSON-only mode for testing
const api = await expose<API>({}, {
  transport: worker,
  platformCapabilities: {
    jsonOnly: true,
    messagePort: false,
    arrayBuffer: false,
    transferable: false,
    transferableStream: false
  }
})
```

## Platform Capabilities

Osra automatically detects what your platform supports:

### Capability Detection

```typescript
import { detectCapabilities } from 'osra'

const capabilities = await detectCapabilities()
console.log(capabilities)
// {
//   jsonOnly: false,
//   messagePort: true,
//   arrayBuffer: true,
//   transferable: true,
//   transferableStream: true
// }
```

### Override Capabilities

```typescript
// Force specific capabilities
const api = await expose<API>({}, {
  transport: worker,
  platformCapabilities: {
    jsonOnly: false,
    messagePort: true,
    arrayBuffer: true,
    transferable: true,
    transferableStream: false // Disable stream transfer
  }
})
```

### Capability-Based Code

```typescript
// Worker that adapts to capabilities
const api = {
  getData: async (options, capabilities) => {
    if (capabilities.transferableStream) {
      // Return a stream
      return new ReadableStream({
        async start(controller) {
          for await (const chunk of generateData()) {
            controller.enqueue(chunk)
          }
          controller.close()
        }
      })
    } else {
      // Return array for limited platforms
      const result = []
      for await (const chunk of generateData()) {
        result.push(chunk)
      }
      return result
    }
  }
}
```

## Complex Type Handling

### The Box/Reviver System

The box/reviver system makes complex types work across all transports, including JSON-only ones:

#### How Boxing Works

When Osra encounters a complex type that can't be directly serialized, it "boxes" it:

```typescript
// Original value
const fn = () => console.log('Hello')

// Boxed representation (simplified)
{
  __osraBox: 'function',
  id: 'uuid-1234',
  port: MessagePort // For bidirectional communication
}

// After revival on the other side
const revivedFn = (...args) => {
  // Proxy that sends calls through MessagePort
  port.postMessage({ type: 'call', args })
  return new Promise(resolve => {
    port.onmessage = (e) => resolve(e.data.result)
  })
}
```

#### Box Types and Their Implementations

```typescript
// Date boxing
const date = new Date('2024-01-01')
// Boxed as: { __osraBox: 'date', value: '2024-01-01T00:00:00.000Z' }
// Revived as: new Date('2024-01-01T00:00:00.000Z')

// Error boxing
const error = new Error('Something failed')
// Boxed as: { __osraBox: 'error', message: 'Something failed', stack: '...' }
// Revived as: Error object with message and stack

// ArrayBuffer boxing (for JSON transports)
const buffer = new ArrayBuffer(1024)
// Boxed as: { __osraBox: 'arrayBuffer', base64: 'AAAA...' }
// Revived as: ArrayBuffer from base64

// TypedArray boxing
const uint8 = new Uint8Array([1, 2, 3])
// Boxed as: { __osraBox: 'typedArray', type: 'Uint8Array', buffer: {...} }
// Revived as: new Uint8Array with same values

// Promise boxing
const promise = Promise.resolve(42)
// Boxed with MessagePort for resolution
// Revived as: Promise that resolves when original resolves

// Function boxing
const fn = (a, b) => a + b
// Boxed with MessagePort for invocation
// Revived as: Proxy function that executes remotely
```

#### Deep Boxing

Osra recursively boxes nested structures:

```typescript
const complexData = {
  created: new Date(),
  process: async (data) => {
    return {
      result: data.toUpperCase(),
      timestamp: new Date(),
      nextStep: () => console.log('Done')
    }
  },
  error: new Error('test'),
  binary: new Uint8Array([1, 2, 3])
}

// All nested complex types are boxed and revived correctly
const result = await api.sendComplex(complexData)
```

### Functions

Functions are serialized as MessagePort proxies:

```typescript
// Worker
const api = {
  // Return a function
  getProcessor: async () => {
    return async (data: any) => {
      // This runs in the worker
      return processData(data)
    }
  },

  // Accept a function
  runWithCallback: async (callback: Function) => {
    for (let i = 0; i < 10; i++) {
      // Call function in main thread
      await callback(i)
    }
  }
}

// Main
const processor = await api.getProcessor()
const result = await processor(myData) // Runs in worker

await api.runWithCallback(async (i) => {
  // This runs in main thread
  console.log(`Progress: ${i}`)
})
```

### Promises

Promises are automatically resolved across contexts:

```typescript
// Worker
const api = {
  // Return a promise
  startLongTask: async () => {
    return new Promise((resolve) => {
      setTimeout(() => resolve('Done!'), 5000)
    })
  },

  // Accept a promise
  waitForSignal: async (signal: Promise<void>) => {
    console.log('Waiting for signal...')
    await signal
    console.log('Signal received!')
  }
}

// Main
const taskPromise = await api.startLongTask()
const result = await taskPromise // Waits 5 seconds

const { promise, resolve } = Promise.withResolvers()
api.waitForSignal(promise)
// Later...
resolve() // Triggers console.log in worker
```

### Streams

ReadableStreams can be transferred or proxied:

```typescript
// Worker
const api = {
  // Return a stream
  streamData: async () => {
    return new ReadableStream({
      async start(controller) {
        for (let i = 0; i < 100; i++) {
          controller.enqueue(`Chunk ${i}`)
          await new Promise(r => setTimeout(r, 100))
        }
        controller.close()
      }
    })
  },

  // Accept a stream
  processStream: async (stream: ReadableStream) => {
    const reader = stream.getReader()
    let count = 0

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      count++
      console.log('Received:', value)
    }

    return count
  }
}

// Main
const stream = await api.streamData()
const reader = stream.getReader()

while (true) {
  const { done, value } = await reader.read()
  if (done) break
  console.log(value)
}
```

### Circular References

Osra handles circular references in objects:

```typescript
// Worker
const api = {
  createCircular: async () => {
    const obj: any = { name: 'root' }
    obj.self = obj // Circular reference
    obj.child = { parent: obj } // Another circular reference
    return obj
  }
}

// Main
const circular = await api.createCircular()
console.log(circular.self === circular) // true
console.log(circular.child.parent === circular) // true
```

## Performance Optimization

### Transfer vs Clone

```typescript
import { transfer } from 'osra'

// Clone (default) - data is copied
const cloned = await api.process(largeBuffer)
// largeBuffer is still usable

// Transfer - data is moved
const transferred = await api.process(transfer(largeBuffer))
// largeBuffer is now detached and unusable, but this is much faster
```

### Batch Operations

```typescript
// Inefficient - multiple round trips
for (const item of items) {
  await api.processItem(item)
}

// Efficient - single round trip
await api.processItems(items)

// Or use streaming for large datasets
const stream = api.processStream()
const writer = stream.getWriter()
for (const item of items) {
  await writer.write(item)
}
await writer.close()
```

### Connection Pooling

```typescript
// Create a pool of workers
class WorkerPool {
  private workers: Worker[] = []
  private apis: any[] = []
  private currentIndex = 0

  async initialize(size: number) {
    for (let i = 0; i < size; i++) {
      const worker = new Worker('./worker.js', { type: 'module' })
      const api = await expose<WorkerAPI>({}, { transport: worker })
      this.workers.push(worker)
      this.apis.push(api)
    }
  }

  async execute(task: any) {
    // Round-robin distribution
    const api = this.apis[this.currentIndex]
    this.currentIndex = (this.currentIndex + 1) % this.apis.length
    return api.process(task)
  }

  terminate() {
    this.workers.forEach(w => w.terminate())
  }
}

const pool = new WorkerPool()
await pool.initialize(navigator.hardwareConcurrency || 4)

// Process tasks in parallel
const results = await Promise.all(
  tasks.map(task => pool.execute(task))
)
```

### Memory Management

```typescript
// Use AbortSignal for cleanup
const controller = new AbortController()

const api = await expose<API>({}, {
  transport: worker,
  unregisterSignal: controller.signal
})

// Use the API...

// Clean up when done
controller.abort()

// Also clean up MessagePorts when done with functions
const processor = await api.getProcessor()
await processor(data)
// processor.destroy() // If available
```

## Error Handling & Debugging

### Error Preservation

```typescript
// Worker
const api = {
  mightFail: async (shouldFail: boolean) => {
    if (shouldFail) {
      const error = new Error('Operation failed')
      error.code = 'OPERATION_FAILED'
      error.details = { timestamp: Date.now() }
      throw error
    }
    return 'Success'
  }
}

// Main
try {
  await api.mightFail(true)
} catch (error) {
  console.log(error.message)  // 'Operation failed'
  console.log(error.code)      // 'OPERATION_FAILED'
  console.log(error.details)   // { timestamp: ... }
  console.log(error.stack)     // Full stack trace
}
```

### Custom Logger

```typescript
const logger = {
  log: (...args) => {
    console.log('[Osra]', new Date().toISOString(), ...args)
  },
  error: (...args) => {
    console.error('[Osra ERROR]', new Date().toISOString(), ...args)
  },
  warn: (...args) => {
    console.warn('[Osra WARN]', new Date().toISOString(), ...args)
  }
}

const api = await expose<API>({}, {
  transport: worker,
  logger
})
```

### Debug Mode

```typescript
// Enable verbose logging
if (process.env.NODE_ENV === 'development') {
  const api = await expose<API>({}, {
    transport: worker,
    logger: {
      log: (...args) => {
        console.group('Osra Message')
        console.log('Timestamp:', Date.now())
        console.log('Data:', ...args)
        console.trace()
        console.groupEnd()
      }
    }
  })
}
```

## Security Considerations

### Origin Validation

```typescript
// Only accept messages from specific origin
const api = await expose<API>({}, {
  transport: childWindow,
  origin: 'https://trusted-domain.com'
})
```

### Key-Based Authentication

```typescript
// Worker
const api = {
  secure: async (data: any) => {
    // Process secure data
    return encrypt(data)
  }
}

expose(api, {
  transport: self,
  key: 'shared-secret-key'
})

// Main
const secureAPI = await expose<API>({}, {
  transport: worker,
  key: 'shared-secret-key' // Must match
})
```

### Sandboxing

```typescript
// Create sandboxed worker
const worker = new Worker('./worker.js', {
  type: 'module',
  credentials: 'omit', // Don't send cookies
  // Note: CSP headers should also be configured
})

// Use name-based connection for additional security
const api = await expose<API>({}, {
  transport: worker,
  name: 'main-context',
  remoteName: 'worker-context',
  key: generateSecureKey()
})
```

## Custom Transports

### WebRTC DataChannel

```typescript
const rtcTransport = {
  emit: (message: any) => {
    dataChannel.send(JSON.stringify(message))
  },

  receive: (listener: (message: any) => void) => {
    const handler = (event: MessageEvent) => {
      listener(JSON.parse(event.data))
    }

    dataChannel.addEventListener('message', handler)

    return () => {
      dataChannel.removeEventListener('message', handler)
    }
  }
}

const api = await expose<API>({}, { transport: rtcTransport })
```

### Node.js IPC

```typescript
// Child process
import { expose } from 'osra'

const ipcTransport = {
  emit: (message: any) => {
    process.send!(message)
  },

  receive: (listener: (message: any) => void) => {
    process.on('message', listener)
    return () => {
      process.off('message', listener)
    }
  }
}

expose(api, { transport: ipcTransport })

// Parent process
import { fork } from 'child_process'

const child = fork('./child.js')

const parentTransport = {
  emit: (message: any) => {
    child.send(message)
  },

  receive: (listener: (message: any) => void) => {
    child.on('message', listener)
    return () => {
      child.off('message', listener)
    }
  }
}

const api = await expose<API>({}, { transport: parentTransport })
```

## Browser Extension Integration

### Background Script

```typescript
// background.js
import { expose } from 'osra'

const backgroundAPI = {
  fetchWithAuth: async (url: string) => {
    const token = await getAuthToken()
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` }
    })
    return response.json()
  },

  storage: {
    get: async (key: string) => {
      const result = await chrome.storage.local.get(key)
      return result[key]
    },

    set: async (key: string, value: any) => {
      await chrome.storage.local.set({ [key]: value })
    }
  }
}

// Expose to extension pages
expose(backgroundAPI, { transport: chrome.runtime })
```

### Content Script

```typescript
// content.js
import { expose } from 'osra'

const contentAPI = await expose<BackgroundAPI>({}, {
  transport: chrome.runtime
})

// Use background APIs from content script
const data = await contentAPI.fetchWithAuth('/api/user')
await contentAPI.storage.set('userData', data)
```

### Popup/Options Page

```typescript
// popup.js
import { expose } from 'osra'

const backgroundAPI = await expose<BackgroundAPI>({}, {
  transport: chrome.runtime
})

// Bidirectional communication with popup-specific API
const popupAPI = {
  onDataReceived: async (data: any) => {
    updateUI(data)
  }
}

const connection = await expose<any>(popupAPI, {
  transport: chrome.runtime
})
```

## Testing Strategies

### Unit Testing

```typescript
// worker.test.ts
import { expose } from 'osra'
import { MessageChannel } from 'worker_threads'

describe('WorkerAPI', () => {
  let port1: MessagePort, port2: MessagePort
  let api: WorkerAPI

  beforeEach(async () => {
    const channel = new MessageChannel()
    port1 = channel.port1
    port2 = channel.port2

    // Expose worker API on port1
    expose(workerAPI, { transport: port1 })

    // Connect from port2
    api = await expose<WorkerAPI>({}, { transport: port2 })
  })

  afterEach(() => {
    port1.close()
    port2.close()
  })

  test('should process data', async () => {
    const result = await api.processData({ value: 42 })
    expect(result).toBe(84)
  })

  test('should handle errors', async () => {
    await expect(api.failingMethod()).rejects.toThrow('Expected error')
  })
})
```

### Integration Testing

```typescript
// integration.test.ts
import { expose } from 'osra'
import puppeteer from 'puppeteer'

describe('Worker Integration', () => {
  let browser: Browser
  let page: Page

  beforeAll(async () => {
    browser = await puppeteer.launch()
  })

  afterAll(async () => {
    await browser.close()
  })

  test('should communicate with worker', async () => {
    page = await browser.newPage()

    // Expose test utilities
    await page.exposeFunction('onResult', (result: any) => {
      expect(result).toEqual({ success: true })
    })

    await page.evaluate(() => {
      const worker = new Worker('./worker.js')
      const api = await expose<WorkerAPI>({}, { transport: worker })
      const result = await api.process()
      window.onResult(result)
    })
  })
})
```

### Mocking Osra

```typescript
// mock-osra.ts
export const mockExpose = jest.fn().mockImplementation((value, options) => {
  // Return a proxy that records calls
  return new Proxy({}, {
    get: (target, prop) => {
      return jest.fn().mockResolvedValue(`Mocked ${String(prop)}`)
    }
  })
})

// test.ts
jest.mock('osra', () => ({
  expose: mockExpose
}))

test('should call API', async () => {
  const api = await expose<API>({}, { transport: worker })
  const result = await api.someMethod()
  expect(result).toBe('Mocked someMethod')
})
```

## Best Practices

1. **Always type your APIs** - Use TypeScript for full type safety
2. **Handle cleanup** - Use AbortSignal and terminate workers
3. **Prefer transfer for large data** - Use `transfer()` for ArrayBuffers
4. **Stream large datasets** - Use async generators or ReadableStreams
5. **Pool workers for parallel processing** - Create worker pools for CPU-intensive tasks
6. **Validate inputs** - Don't trust data from other contexts
7. **Use origin restrictions** - Always specify origin for window communication
8. **Monitor performance** - Log and measure communication overhead
9. **Test thoroughly** - Test both success and error cases
10. **Document your APIs** - Clear documentation helps team collaboration

## Troubleshooting

### Common Issues

**"Cannot clone object"**
- Object contains non-transferable types
- Solution: Serialize manually or use supported types

**"Port is already in use"**
- Multiple expose calls on same transport
- Solution: Use single expose call per transport

**"Message target not found"**
- Remote side hasn't called expose yet
- Solution: Ensure both sides are initialized

**Performance degradation**
- Sending too much data or too frequently
- Solution: Batch operations, use streaming, or transfer

**Memory leaks**
- Not cleaning up connections
- Solution: Use AbortSignal and terminate workers
# Osra - Easy Communication Between Workers

[![npm version](https://img.shields.io/npm/v/osra.svg)](https://www.npmjs.com/package/osra)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Osra is a powerful, type-safe communication library for JavaScript/TypeScript that enables seamless inter-context communication with support for complex data types that normally wouldn't be transferable.

## Features

- **Universal Communication** - Works across Workers, SharedWorkers, ServiceWorkers, Windows, MessagePorts, WebSockets, and Browser Extensions
- **Rich Type Support** - Seamlessly handle Promises, Functions, Streams, Dates, Errors, TypedArrays, and more
- **Full TypeScript Support** - Complete type safety with automatic type inference
- **Intelligent Transport** - Automatically detects platform capabilities and adapts accordingly
- **Zero Dependencies** - Lightweight with no external runtime dependencies
- **Graceful Degradation** - Falls back to JSON-only mode when advanced features aren't supported

## Installation

```bash
npm install osra
```

## Quick Start

### Basic Worker Communication

**Worker file (`worker.ts`):**
```typescript
import { expose } from 'osra'

const api = {
  // Simple function
  add: async (a: number, b: number) => a + b,

  // Function returning complex objects
  getUser: async (id: string) => ({
    id,
    name: 'John Doe',
    createdAt: new Date(),
    // Even functions work!
    greet: () => `Hello, I'm user ${id}`,
  }),

  // Streaming data
  streamData: async function* () {
    for (let i = 0; i < 10; i++) {
      yield i
      await new Promise(r => setTimeout(r, 100))
    }
  }
}

export type WorkerAPI = typeof api

// Expose the API through the worker
expose(api, { transport: self })
```

**Main thread (`main.ts`):**
```typescript
import { expose } from 'osra'
import type { WorkerAPI } from './worker'

const worker = new Worker('./worker.js', { type: 'module' })

// Connect to the worker with full type safety
const api = await expose<WorkerAPI>({}, { transport: worker })

// Call functions as if they were local
const sum = await api.add(5, 3) // 8

// Complex objects work seamlessly
const user = await api.getUser('123')
console.log(user.createdAt) // Date object, not string!
const greeting = await user.greet() // "Hello, I'm user 123"

// Stream data
for await (const value of api.streamData()) {
  console.log(value) // 0, 1, 2, ...
}
```

## Advanced Examples

### Window to Window Communication

```typescript
// Parent window
import { expose } from 'osra'

const childWindow = window.open('child.html')

const parentAPI = {
  notifyParent: async (message: string) => {
    console.log('Child says:', message)
  }
}

const childAPI = await expose<ChildAPI>(parentAPI, {
  transport: childWindow,
  origin: 'https://child-domain.com' // Optional: restrict origin
})

// Child window (child.html)
const childAPI = {
  initialize: async () => {
    console.log('Child initialized!')
    return true
  }
}

expose(childAPI, { transport: window.parent })
```

### SharedWorker Communication

```typescript
// Shared Worker
import { expose } from 'osra'

const connections = new Set<string>()

const api = {
  connect: async (clientId: string) => {
    connections.add(clientId)
    return {
      broadcast: async (message: string) => {
        // Broadcast to all connected clients
        console.log(`${clientId} broadcasts: ${message}`)
      }
    }
  }
}

self.addEventListener('connect', (event) => {
  const port = event.ports[0]
  expose(api, { transport: port })
})

// Client
const sharedWorker = new SharedWorker('./shared-worker.js')
const api = await expose<SharedWorkerAPI>({}, { transport: sharedWorker })
const connection = await api.connect('client-1')
await connection.broadcast('Hello everyone!')
```

### Browser Extension Communication

```typescript
// Background script
import { expose } from 'osra'

const api = {
  fetchData: async (url: string) => {
    const response = await fetch(url)
    return response.json()
  }
}

expose(api, { transport: chrome.runtime })

// Content script or popup
const api = await expose<BackgroundAPI>({}, { transport: chrome.runtime })
const data = await api.fetchData('https://api.example.com/data')
```

### Custom Transport

```typescript
import { expose } from 'osra'

// Create custom transport for any communication channel
const customTransport = {
  emit: (message: any, transferables?: Transferable[]) => {
    // Send message through your custom channel
    myCustomChannel.send(message, transferables)
  },
  receive: (listener: (message: any) => void) => {
    // Listen for messages from your custom channel
    myCustomChannel.on('message', listener)

    // Return cleanup function
    return () => myCustomChannel.off('message', listener)
  }
}

const api = await expose<RemoteAPI>({}, { transport: customTransport })
```

## Supported Types

Osra automatically handles serialization/deserialization of:

- **Primitives**: `boolean`, `number`, `string`, `null`, `undefined`, `BigInt`
- **Objects & Arrays**: Including nested structures
- **Built-in Objects**: `Date`, `RegExp`, `Map`, `Set`, `Error`
- **Binary Data**: `ArrayBuffer`, `TypedArray`, `Blob`, `File`
- **Functions**: Callable across contexts with full async support
- **Promises**: Seamlessly await remote promises
- **Streams**: `ReadableStream` support (WritableStream coming soon)
- **Transferables**: `MessagePort`, `ImageBitmap`, `OffscreenCanvas`

## API Reference

### `expose<T>(value, options)`

The main function for establishing communication between contexts.

#### Parameters

- `value`: The object/value to expose (server-side) or an empty object (client-side)
- `options`: Configuration object
  - `transport`: The transport to use (Worker, Window, MessagePort, etc.)
  - `name?`: Optional name for this endpoint (default: random UUID)
  - `remoteName?`: Name of the remote endpoint to connect to
  - `key?`: Optional key for additional security
  - `origin?`: Origin restriction for Window communication
  - `unregisterSignal?`: AbortSignal to clean up the connection
  - `transferAll?`: Automatically transfer all transferables (default: false)

#### Returns

Promise resolving to the remote API object with full type safety.

### Transfer Optimization

For large binary data, use the `transfer` helper to transfer instead of clone:

```typescript
import { expose, transfer } from 'osra'

const api = {
  processImage: async (imageData: ImageData) => {
    // Process image...
    return transfer(imageData) // Transfer back instead of cloning
  }
}
```

## Protocol Modes

### Bidirectional Mode (Default)

Both sides can expose APIs and call each other:

```typescript
// Side A
const remoteAPI = await expose<RemoteAPI>(localAPI, { transport })

// Side B
const remoteAPI = await expose<RemoteAPI>(localAPI, { transport })
```

### Unidirectional Mode

One-way communication when only one side needs to call the other:

```typescript
// Server (exposes API)
expose(api, { transport })

// Client (calls API)
const api = await expose<API>({}, { transport })
```

## Platform Capabilities

Osra automatically detects platform capabilities and adapts its behavior:

- **MessagePort Transfer**: Can transfer MessagePort objects for function calls
- **ArrayBuffer Transfer**: Can transfer ArrayBuffers instead of cloning
- **Stream Transfer**: Can transfer ReadableStreams directly
- **Structured Clone**: Supports native structured cloning

When operating in JSON-only mode (WebSockets, Browser Extensions), Osra uses a box/reviver system to serialize complex types like Functions, Promises, Dates, Errors, and TypedArrays into JSON-compatible representations that are automatically revived on the receiving end.

## Performance Tips

1. **Use Transfer for Large Data**: Transfer ArrayBuffers and TypedArrays instead of cloning
2. **Batch Operations**: Group multiple calls when possible
3. **Stream Large Datasets**: Use async generators for large data sets
4. **Reuse Connections**: Keep connections alive for multiple operations

## Browser Compatibility

- Chrome/Edge 88+
- Firefox 85+
- Safari 15+
- Node.js 16+ (with Worker Threads)

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT © [Banou26](https://github.com/Banou26)

## Roadmap

- [ ] WritableStream support
- [ ] Custom revivable plugins for user-defined types
- [ ] Performance optimizations for large object graphs
- [ ] Better error handling and debugging tools
- [ ] WebRTC DataChannel transport
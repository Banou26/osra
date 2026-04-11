# Osra API Reference

## Core Functions

### `expose<T>(value, options): Promise<T>`

The primary function for establishing communication between JavaScript execution contexts.

```typescript
import { expose } from 'osra'

// Server side (exposing functions)
expose(api, { transport: worker })

// Client side (consuming functions)
const api = await expose<API>({}, { transport: worker })
```

#### Type Parameters

- `T extends Capable` - The type of the value being exposed or expected from the remote side

#### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `value` | `Capable` | The value to expose (server) or empty object `{}` (client) |
| `options` | `ExposeOptions` | Configuration options |

#### Options

```typescript
interface ExposeOptions {
  transport: Transport
  name?: string
  remoteName?: string
  key?: string
  origin?: string
  unregisterSignal?: AbortSignal
  logger?: Logger
}
```

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `transport` | `Transport` | Yes | The communication channel (Worker, Window, MessagePort, etc.) |
| `name` | `string` | No | Unique identifier for this endpoint (auto-generated if not provided) |
| `remoteName` | `string` | No | Name of the remote endpoint to connect to |
| `key` | `string` | No | Shared secret for additional security |
| `origin` | `string` | No | Origin restriction for Window postMessage |
| `unregisterSignal` | `AbortSignal` | No | Signal to clean up the connection |
| `logger` | `Logger` | No | Custom logger for debugging |

#### Returns

Returns a `Promise<T>` that resolves to:
- **Server side**: The original value passed in
- **Client side**: A proxy to the remote value with all functions callable

### `transfer<T>(value: T): T`

Opts into transfer (move) semantics for a transferable value. Without this
wrapper osra sends transferables as structured clones (copies) and the
sender-side reference stays usable after the RPC. Wrapping a value hands
its underlying storage off to the receiver and neuters the sender-side
reference — the same thing you'd get by listing it in the transfer list of
`postMessage(msg, [buf])`.

```typescript
import { transfer } from 'osra'

const buffer = new Uint8Array(1024).buffer

// Default: copy. `buffer` remains usable after the call.
await remote.preview(buffer)
console.log(buffer.byteLength) // 1024

// Opt-in transfer. `buffer` is neutered on the sender.
await remote.upload(transfer(buffer))
console.log(buffer.byteLength) // 0
```

- Primitives, `null`, `undefined`, plain objects, `Promise`, `Date`, and
  any other non-transferable value are returned unchanged — safe to wrap
  by accident.
- Typed array views (`Uint8Array`, `DataView`, …) are accepted as a
  convenience; their underlying `.buffer` is what actually gets moved.
- `transfer(transfer(x))` is the same as `transfer(x)` — idempotent.
- If the current platform cannot transfer the given type the wrapper
  silently degrades to a copy; nothing throws.

Must-transfer types (`MessagePort`, `ReadableStream`, `WritableStream`,
`TransformStream`, `OffscreenCanvas`) are always transferred automatically
with or without the wrapper — structured clone cannot represent them.

#### Supported Transferable Types

- `ArrayBuffer`
- Typed array views (`Uint8Array`, `Int16Array`, `DataView`, …)
- `MessagePort`
- `ReadableStream`
- `WritableStream`
- `TransformStream`
- `ImageBitmap`
- `OffscreenCanvas`

## Type System

### Core Types

#### `Capable`

Union type of all values that Osra can handle:

```typescript
type Capable = Structurable | Revivable | Transferable
```

#### `Structurable`

Values that can be structured cloned:

```typescript
type Structurable =
  | Jsonable
  | bigint
  | Date
  | RegExp
  | Blob
  | File
  | ArrayBuffer
  | ArrayBufferView
  | ImageBitmap
  | ImageData
  | Map<Structurable, Structurable>
  | Set<Structurable>
  | Error
  | Array<Structurable>
  | { [key: string]: Structurable }
```

#### `Jsonable`

Values that can be JSON serialized:

```typescript
type Jsonable =
  | boolean
  | null
  | number
  | string
  | Jsonable[]
  | { [key: string]: Jsonable }
```

#### `Revivable`

Complex types that Osra can serialize/deserialize using the box/reviver system. These types work even in JSON-only mode:

```typescript
type Revivable =
  | MessagePort
  | Promise<Capable>
  | TypedArray
  | ArrayBuffer
  | ReadableStream<Capable>
  | Date
  | Error
  | Function
```

The box/reviver system converts these complex types into JSON-serializable "boxes" that are automatically revived on the receiving end, maintaining full functionality.

### Transport Types

#### `Transport`

Union of all supported transport types:

```typescript
type Transport = PlatformTransport | CustomTransport | JsonPlatformTransport
```

#### `PlatformTransport`

Native browser/Node.js communication channels:

```typescript
type PlatformTransport =
  | Window
  | Worker
  | SharedWorker
  | ServiceWorker
  | MessagePort
  | WebSocket
  | chrome.runtime
  | browser.runtime
  | chrome.runtime.Port
  | browser.runtime.Port
```

#### `CustomTransport`

User-defined transport implementation:

```typescript
interface CustomTransport {
  emit: (message: any, transferables?: Transferable[]) => void
  receive: (listener: (message: any) => void) => (() => void) | void
}
```

#### `JsonPlatformTransport`

Transports that use JSON serialization (WebSocket, WebExtension). The box/reviver system ensures complex types still work:

```typescript
type JsonPlatformTransport = WebSocket | chrome.runtime | browser.runtime
```

### Transport Modes

Osra runs in one of two modes, selected from the transport:

- **Capable mode** — structured-clone transports (Worker, SharedWorker,
  ServiceWorker, Window, MessagePort, and any custom transport without
  `isJson: true`). Transferables can be moved with `transfer()`.
- **JSON mode** — `WebSocket`, browser extension runtime/port APIs, and
  any custom transport that sets `isJson: true`. Complex types travel
  through the box/reviver system, so Functions, Promises, Dates, Errors,
  TypedArrays, streams, etc. still work — they're serialized as JSON-safe
  boxes and revived on the other side.

A custom transport can force JSON mode by setting `isJson: true`:

```typescript
const transport = {
  isJson: true,
  emit: (message) => socket.send(JSON.stringify(message)),
  receive: (listener) => socket.on('message', (data) =>
    listener(JSON.parse(data), {}),
  ),
}
```

## Message Protocol

### Protocol Messages

#### Announce Message

Sent when establishing a connection:

```typescript
interface AnnounceMessage {
  protocol: 'osra'
  version: 1
  type: 'announce'
  mode: 'bidirectional' | 'unidirectional-receiving' | 'unidirectional-emitting'
  senderUuid: string
  name?: string
  key?: string
}
```

#### Init Message

Initializes the connection with MessagePort:

```typescript
interface InitMessage {
  protocol: 'osra'
  version: 1
  type: 'init'
  mode: 'bidirectional'
  senderUuid: string
  receiverUuid: string
  port: MessagePort
}
```

#### Data Message

Regular data transmission:

```typescript
interface DataMessage {
  protocol: 'osra'
  version: 1
  type: 'message'
  senderUuid: string
  receiverUuid: string
  message: Capable
}
```

## Advanced Features

### Box/Reviver System

The box/reviver system enables complex types to work even in JSON-only environments (WebSockets, Browser Extensions):

#### How Boxing Works

```typescript
// When sending a function over JSON transport:
const api = {
  callback: async (fn: Function) => {
    // Osra automatically:
    // 1. Creates a MessageChannel
    // 2. "Boxes" the function with a unique ID and MessagePort
    // 3. Sends JSON: { __osraBox: 'function', id: '...', port: MessagePort }
    // 4. On receiving end, "revives" it as a callable proxy function
    await fn('Hello from worker!')
  }
}

// Complex types are automatically boxed:
const data = {
  date: new Date(),           // Boxed as { __osraBox: 'date', value: ISO string }
  error: new Error('test'),    // Boxed as { __osraBox: 'error', message, stack }
  buffer: new ArrayBuffer(10), // Boxed as { __osraBox: 'arrayBuffer', base64: '...' }
  promise: Promise.resolve(42) // Boxed with MessagePort for resolution
}
```

#### Supported Box Types

- `boxFunction` - Functions become callable via MessagePort
- `boxPromise` - Promises resolve/reject across contexts
- `boxDate` - Dates preserved with full precision
- `boxError` - Errors with message and stack trace
- `boxArrayBuffer` - Binary data via base64 encoding
- `boxTypedArray` - Typed arrays with type preservation
- `boxReadableStream` - Streams via MessagePort chunks
- `boxMessagePort` - Port forwarding for bidirectional communication

This system ensures that even over JSON-only transports, you can still use the full power of JavaScript's type system.

### Connection Modes

#### Bidirectional Mode

Both sides can expose and call APIs:

```typescript
// Side A
const localAPI = { localMethod: async () => 'A' }
const remoteAPI = await expose<RemoteAPI>(localAPI, { transport })
await remoteAPI.remoteMethod() // Call remote

// Side B
const localAPI = { remoteMethod: async () => 'B' }
const remoteAPI = await expose<LocalAPI>(localAPI, { transport })
await remoteAPI.localMethod() // Call remote
```

#### Unidirectional Mode

One-way communication:

```typescript
// Server (exposes only)
expose(api, { transport })

// Client (calls only)
const api = await expose<API>({}, { transport })
```

### Error Handling

Osra preserves error information across contexts:

```typescript
// Worker
const api = {
  mightFail: async () => {
    throw new Error('Something went wrong')
  }
}

// Main thread
try {
  await api.mightFail()
} catch (error) {
  console.log(error.message) // "Something went wrong"
  console.log(error.stack)    // Full stack trace preserved
}
```

### Cleanup

Use `AbortSignal` to clean up connections:

```typescript
const controller = new AbortController()

const api = await expose<API>({}, {
  transport: worker,
  unregisterSignal: controller.signal
})

// Later, clean up
controller.abort()
```

### Custom Logger

Provide a logger for debugging:

```typescript
const api = await expose<API>({}, {
  transport: worker,
  logger: {
    log: (...args) => console.log('[Osra]', ...args),
    error: (...args) => console.error('[Osra]', ...args)
  }
})
```

## Type Guards

Osra exports type guard functions for runtime type checking:

```typescript
import {
  isJsonable,
  isStructurable,
  isRevivable,
  isCapable,
  isTypedArray,
  isTransferable
} from 'osra'

// Check if a value can be sent
if (isCapable(myValue)) {
  // Safe to send through Osra
}

// Check for specific capabilities
if (isTransferable(myBuffer)) {
  // Can be transferred instead of cloned
}
```

## Performance Considerations

### Transfer vs Clone

```typescript
// Cloning (default) - data is copied
const result = await api.processData(largeBuffer)

// Transfer - data is moved (original becomes unusable)
const result = await api.processData(transfer(largeBuffer))
// largeBuffer is now detached and unusable
```

### Connection Reuse

```typescript
// Good - reuse connection
const api = await expose<API>({}, { transport: worker })
await api.method1()
await api.method2()
await api.method3()

// Avoid - creating multiple connections
await (await expose<API>({}, { transport: worker })).method1()
await (await expose<API>({}, { transport: worker })).method2()
```

### Streaming Large Data

```typescript
// Good - stream data
const api = {
  *streamLargeData() {
    for (let i = 0; i < 1000000; i++) {
      yield computeDataPoint(i)
    }
  }
}

// Avoid - return all at once
const api = {
  getLargeData() {
    const results = []
    for (let i = 0; i < 1000000; i++) {
      results.push(computeDataPoint(i))
    }
    return results
  }
}
```

## Limitations

### What Cannot Be Sent

- DOM nodes
- Window/Document objects
- Native browser APIs (localStorage, fetch, etc.)
- Symbols
- WeakMap/WeakSet
- Proxies
- Private class fields

### Workarounds

For unsupported types, serialize manually:

```typescript
// Can't send DOM node directly
const api = {
  getElement: async () => {
    const elem = document.querySelector('#my-element')
    // Return serializable representation
    return {
      id: elem.id,
      className: elem.className,
      innerHTML: elem.innerHTML
    }
  }
}
```

## TypeScript Usage

### Importing Types

```typescript
// worker.ts
export type WorkerAPI = typeof api

// main.ts
import type { WorkerAPI } from './worker'
const api = await expose<WorkerAPI>({}, { transport })
```

### Generic APIs

```typescript
interface GenericAPI<T> {
  process: (data: T) => Promise<T>
  transform: (data: T[]) => Promise<T[]>
}

const api = await expose<GenericAPI<string>>({}, { transport })
const result = await api.process('hello') // Type-safe as string
```

### Conditional Types

```typescript
type APIResponse<T> = T extends string
  ? { text: T }
  : T extends number
  ? { value: T }
  : { data: T }

interface SmartAPI {
  process<T>(input: T): Promise<APIResponse<T>>
}
```
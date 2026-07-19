# osra

[![npm version](https://img.shields.io/npm/v/osra.svg)](https://www.npmjs.com/package/osra)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

osra is a zero-runtime-dependency TypeScript RPC library. Both sides call `expose(value, { transport })` and each receives the other's value live: functions stay callable, generators stream, errors and aborts propagate, across Workers, iframes, WebSockets, extensions, or any custom channel.

## Features

- **Zero runtime dependencies**: one ESM module; the single declared dependency (`@types/webextension-polyfill`) is types-only, supporting the published declarations
- **Symmetric API**: both sides call `expose()`; either side can pass functions, both can call
- **Deep type support**: functions, promises, async generators, `ReadableStream`/`WritableStream`, `MessagePort`, `AbortSignal`, `Error` subclasses, `Blob`/`File`/`FileList`, `Request`/`Response`, `Map`/`Set`, typed arrays, `BigInt`, `Symbol`, …
- **JSON-mode degradation**: most value types work over text-only transports (WebSocket, extension messaging); `Date`, `Map`, typed arrays, even `NaN`/`±Infinity` survive
- **`identity()`** for reference-preserving sends, **`transfer()`** for zero-copy moves
- **Strict TypeScript**: `Remote<T>` maps your API type across the wire; a compile-time `Capable` check rejects non-serializable values with the offending path pinpointed
- **Tested** on Chromium, Firefox, and WebKit via Playwright

## Install

```sh
npm install osra
```

## Quick Start

```ts
// worker.ts
import { expose } from 'osra'

const api = {
  add: async (a: number, b: number) => a + b,
  makeCounter: async () => {
    let count = 0
    return async () => ++count
  },
  streamData: async function* () {
    for (let i = 0; i < 3; i++) yield i
  },
}

export type Api = typeof api

expose(api, { transport: globalThis })
```

```ts
// main.ts
import type { Api } from './worker'

import { expose } from 'osra'

const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })

const remote = await expose<Api>({}, { transport: worker })

await remote.add(40, 2) // 42

const counter = await remote.makeCounter()
await counter() // 1
await counter() // 2

for await (const n of await remote.streamData()) {
  console.log(n) // 0, 1, 2
}
```

Both sides call `expose()`; the returned promise resolves with the remote side's value once the handshake completes. A side that only serves (like the worker above) can ignore the returned promise.

### Options

| Option | Default | Description |
|---|---|---|
| `transport` | required | The channel to communicate over (see [Transports](#transports)) |
| `key` | `'__OSRA_DEFAULT_KEY__'` | Namespacing tag that lets multiple independent osra connections share one channel; it does not identify peers |
| `origin` | `'*'` | On window transports: sets the outbound `postMessage` target origin **and** filters inbound messages by `event.origin`; the initial announce beacon alone goes out with `'*'` (see Window ↔ iframe) |
| `name` / `remoteName` | - | Label your endpoint / only accept envelopes from a matching peer name |
| `unregisterSignal` | - | `AbortSignal` that tears the connection down (see [Lifecycle](#error-handling--lifecycle)) |
| `uuid` / `remoteUuid` | random / - | Pin instance uuids (`remoteUuid` is otherwise learned from the peer's announce); when both sides preset each other's `remoteUuid`, the announce handshake is skipped |
| `revivableModules` | - | `defaults => modules` function to add, drop, reorder, or override revivable modules |

If multiple peers connect over the same transport, the returned promise resolves with the **first** peer's value; later peers still connect and can call your exposed value.

## Supported types

Transports are either **structured-clone** (Worker, Window, MessagePort, SharedWorker) or **JSON** (WebSocket, web extension messaging, custom transports with `isJson: true`).

| Type | Clone | JSON | Notes |
|---|---|---|---|
| JSON primitives, plain objects, arrays | ✅ | ✅ | |
| `undefined`, `NaN`, `±Infinity` | ✅ | ✅ | preserved even over JSON |
| `Date`, `BigInt`, `Map`, `Set` | ✅ | ✅ | |
| Typed arrays, `ArrayBuffer` | ✅ | ✅ | subarray views round-trip their visible bytes; the revived view is full-length over a fresh buffer (`byteOffset` 0, length preserved) |
| `Error` + subclasses | ✅ | ✅ | built-ins (`TypeError`, `RangeError`, `AggregateError` with nested errors, `DOMException`, …) revive as their own class; custom subclasses revive as `Error` with `name`, `message`, `stack`, `cause` preserved (`DOMException` drops `cause`) |
| `Symbol` | ✅ | ✅ | `Symbol.for` registry symbols round-trip by key; others keep per-connection identity |
| `RegExp` | ✅ | ❌ | |
| `SharedArrayBuffer` | ✅ | ❌ | shared memory across the contexts |
| Function | ✅ | ✅ | becomes `(...args) => Promise<result>`; arguments and results recurse through the same boxing |
| `Promise` | ✅ | ✅ | |
| Async generators / async iterables | ✅ | ✅ | `next`/`return`/`throw` proxied; `for await` works; early `break` runs the source's `finally` |
| `ReadableStream` | ✅ | ✅ | credit-window backpressure; cancel reason crosses |
| `WritableStream` | ✅ | ✅ | write/close/abort with acks; sink errors reject the writer with an `Error` carrying the message string only |
| `MessagePort` | ✅ | ✅ | revives as a real `MessagePort` on both transport kinds; on clone transports the sent port is moved (no longer usable on the sender), over JSON it is bridged by port-id messages |
| `AbortSignal` | ✅ | ✅ | abort and reason propagate |
| `Blob` / `File` / `FileList` | ✅ | ❌ | revive as themselves via structured clone (clone transports only); over JSON send an `ArrayBuffer` instead |
| `Request` / `Response` / `Headers` | ✅ | ✅ | streamed bodies; `Request.signal` propagates; `Response.url`/`redirected` restored; opaque status-0 revives as `Response.error()` |
| `Event` / `CustomEvent` | ✅ | ✅ | subclass fields beyond `detail` are dropped |
| `EventTarget` | ✅ | ✅ | revives as a listener-only façade: `add`/`removeEventListener` proxy to the source; you can't dispatch through it |
| Other structured-clonables (`ImageData`, `DOMRect`, `CryptoKey`, …) | ✅ | ❌ | pass through structured clone untouched |
| Transfer-only host objects (`OffscreenCanvas`, `MediaStreamTrack`, `RTCDataChannel`, …) | ✅ | ❌ | always moved to the peer |
| `ImageBitmap`, `VideoFrame`, `AudioData` | ✅ | ❌ | copied by structured clone; wrap in `transfer()` to move |
| `WeakMap` / `WeakSet`, other unclonables | ❌ | ❌ | coerce to `{}` at runtime, rejected at compile time |

## Transports

### Worker

Pass the `Worker` on the page side and `globalThis` (the `DedicatedWorkerGlobalScope`) inside the worker; see [Quick Start](#quick-start). Inside a worker, pass `globalThis` directly; the `Transport` union includes a structural `WorkerSelf` member, so it typechecks without a cast even in code compiled under `lib.dom`.

### Window ↔ iframe

`message` events fire on the window that receives them, so each side pairs the *other* window for emit with its *own* window for receive. `origin` is applied in both directions, with one exception: the initial announce beacon (which carries only channel identifiers) is posted with target origin `'*'` so it can reach an iframe whose document has not committed yet; announce replies and all later traffic use the configured origin, and inbound filtering always applies.

```ts
// parent
const iframe = document.querySelector('iframe')!
const remote = await expose<IframeApi>(parentApi, {
  transport: { emit: iframe.contentWindow!, receive: window },
  origin: 'https://app.example.com',
})
```

```ts
// iframe
const remote = await expose<ParentApi>(iframeApi, {
  transport: { emit: window.parent, receive: window },
  origin: 'https://host.example.com',
})
```

### SharedWorker

Pass the `SharedWorker` instance directly on the page side; osra rides its `.port` internally. Inside the worker, expose per connected port:

```ts
// page
const sharedWorker = new SharedWorker(new URL('./shared.ts', import.meta.url), { type: 'module' })
const remote = await expose<Api>({}, { transport: sharedWorker })
```

```ts
// shared.ts
import { expose } from 'osra'

const api = { add: async (a: number, b: number) => a + b }

globalThis.addEventListener('connect', event => {
  for (const port of (event as MessageEvent).ports) expose(api, { transport: port })
})
```

### WebSocket

JSON mode. You can `expose()` while the socket is still `CONNECTING`; outbound envelopes queue until open. The other end is anything that relays frames to a peer also running osra:

```ts
const socket = new WebSocket('wss://relay.example.com')
const remote = await expose<PeerApi>(localApi, { transport: socket })
```

### Service worker

A `ServiceWorker` can only emit and a `ServiceWorkerContainer` can only receive, so combine them as a custom pair:

```ts
const registration = await navigator.serviceWorker.ready
const remote = await expose<SwApi>(pageApi, {
  transport: { emit: registration.active!, receive: navigator.serviceWorker },
})
```

### Web extension

JSON mode. `runtime.Port` and the runtime itself (`sendMessage`/`onMessage`) work as standalone transports. `onConnect` and `onMessage` are receive-only: pass them as the `receive` half of a custom `{ emit, receive }` pair, or expose per connected port as below; `expose()` requires a transport that can both emit and receive.

```ts
// content script
const port = browser.runtime.connect()
const background = await expose<BackgroundApi>(contentApi, { transport: port })
```

```ts
// background
browser.runtime.onConnect.addListener(port => {
  expose(backgroundApi, { transport: port })
})
```

If you accept `onConnectExternal`/`onMessageExternal`, filter senders yourself inside a custom `receive` wrapper before invoking osra's listener; `expose()` does not surface the per-message context. The `MessageContext` (with `sender`) reaches only direct users of `registerOsraMessageListener`.

### Custom transports

Any plain object with `emit` and `receive` works. Each may be a platform transport or a function; a function `receive` may return an unsubscribe callback. Set `isJson: true` when the channel can't carry transferables:

```ts
const channel = new BroadcastChannel('app')

const remote = await expose<PeerApi>(localApi, {
  transport: {
    isJson: true,
    emit: message => channel.postMessage(message),
    receive: listener => {
      const handler = (event: MessageEvent) => listener(event.data, {})
      channel.addEventListener('message', handler)
      return () => channel.removeEventListener('message', handler)
    },
  },
})
```

Custom transports **must be plain objects**: prototype-based objects (e.g. Node `EventEmitter`s) with `emit` methods are deliberately not detected as custom transports.

## `identity()`

`identity(value)` preserves reference identity across the connection: sending the same wrapped value twice revives as the same object on the peer, and when the peer wraps the revived object in `identity()` and sends it back, you receive your original reference (`===`). Without it, every send produces an independent copy, including the return trip: a revived value passed back *bare* arrives as a fresh copy, so the returning side must re-wrap it.

```ts
import { expose, identity } from 'osra'

const settings = { theme: 'dark' }
expose({
  getSettings: async () => identity(settings),
  saveSettings: async (saved: typeof settings) => {
    // when the remote sends back identity(saved): saved === settings
  },
}, { transport: worker })
```

## `transfer()`

`transfer(value)` opts a `Transferable` (`ArrayBuffer`, typed-array views, `ImageBitmap`, `VideoFrame`, `AudioData`, …) into move semantics: ownership transfers to the peer instead of copying. Detachment applies to full-window views only (`byteOffset` 0 spanning the whole buffer): `transfer()` on a subarray view ships a copy of just its window and leaves the sender's buffer intact. On JSON transports it silently degrades to a copy. `ReadableStream`/`WritableStream` are never moved: they are proxied chunk by chunk, so `transfer()` adds nothing for them.

```ts
import { transfer } from 'osra'

const pixels = new ArrayBuffer(16_000_000)
await remote.render(transfer(pixels)) // moved - pixels is detached locally
```

## Error handling & lifecycle

- Remote functions that throw reject the caller's promise with the revived error. Built-in classes (`TypeError`, `RangeError`, `SyntaxError`, `ReferenceError`, `EvalError`, `URIError`, `AggregateError`, `DOMException`) revive as instances of the same class; custom `Error` subclasses revive as plain `Error` with `name`, `message`, `stack`, and `cause` preserved.
- `expose()` rejects when the transport can't both emit and receive (`{ emit }` or `{ receive }` alone is a configuration error), and when a peer sends a malformed `init` payload (the revive error surfaces instead of hanging).
- Aborting `unregisterSignal`:
  - the pending `expose()` rejects with the abort reason,
  - a protocol `close` is sent to every connected peer and per-connection state is disposed,
  - pending RPC calls reject with `'osra: connection closed'` on **both** sides (the peer receiving `close` rejects its pending calls too),
  - proxied streams on wire-routed channels (JSON transports) are cancelled/aborted with the same error.
- An already-aborted `unregisterSignal` short-circuits: nothing starts and `expose()` rejects immediately with the signal's abort reason.
- Promises and streams riding real transferred `MessagePort`s on structured-clone transports live independently of the connection and survive its closure; wire-routed traffic does not.
- After aborting, calling `expose()` again on the same transport performs a fresh handshake.

```ts
const controller = new AbortController()
const remote = await expose<Api>({}, { transport: worker, unregisterSignal: controller.signal })

const pending = remote.slowCall()
controller.abort(new Error('shutting down'))
// pending rejects with 'osra: connection closed'
```

**Trust model**: `key` is a namespacing tag that lets independent connections share one channel; it does not identify peers. `origin` scopes window messaging to a named origin in both directions; set it whenever you talk across origins. Malformed payloads surface as errors rather than hangs, and per-connection port buffers are bounded (2048-message reorder buffer per port, 1024 pending ports, 128 remembered closed ports); flood-resistance hardening beyond these caps is incomplete.

## Limitations

- **Circular structures throw** a `TypeError` at send time; break the cycle or restructure.
- **Shared references duplicate**: two fields pointing at the same object arrive as two copies unless wrapped with `identity()`.
- **Classes/prototypes are not preserved**: class instances are not walked by the serializer; structured-clonable ones cross as prototype-less data, and an instance carrying function-valued own properties silently coerces to `{}` via the unclonable path (the compile-time `Capable` check flags it first). Expose plain objects and functions.
- **Unclonable values** (`WeakMap`, `WeakSet`, exotic host objects) coerce to `{}` and fail the compile-time check.
- **One-shot bodies**: sending the same `Request`/`Response`/`ReadableStream` twice fails; the body locks at first send.
- **Generic functions collapse** in `Remote<T>`: mapped types can't preserve generic signatures.
- **Multi-peer**: only the first peer's value is accessible through the returned promise.
- **Everything is async**: sync return values still arrive as `Promise`s.

## TypeScript

`Remote<T>` is what the other side sees: functions become `(...args) => Promise<Awaited<R>>`, containers map recursively, platform objects revive as themselves.

`expose()` validates the value you pass at compile time against `Capable`, the union of everything serializable for the inferred transport (narrower on JSON transports). Failures pinpoint the offending path (for elements of non-tuple arrays the report stops at the array itself; only tuples are indexed element by element):

```ts
expose({ ok: async () => 1, cache: new WeakMap() }, { transport: worker })
// type error: Value type must resolve to a Capable, with `cache` identified as the bad field
```

The published declarations require **TypeScript >= 5.9** with `strict` mode (validated on 5.9 by the documentation build, which type-checks every example against the published types, and on TypeScript 7 by `npm run check-consumer-types`).

## Documentation

- [API reference](./docs/API.md)
- [Advanced usage](./docs/ADVANCED.md)

## Development

```sh
npm test                      # build lib + test bundle, run the Playwright matrix (chromium/firefox/webkit)
npm run test-extension        # web extension suite (needs a headed browser/display)
npm run check-consumer-types  # validate the published .d.ts as an npm consumer sees it
```

## License

[MIT](./LICENSE)

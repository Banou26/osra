# osra

[![npm version](https://img.shields.io/npm/v/osra.svg)](https://www.npmjs.com/package/osra)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

osra is a zero-runtime-dependency TypeScript RPC library that connects two JavaScript contexts over any message channel. Both sides call `expose(value, { transport })` and each receives the other's value with live semantics: functions become callable async proxies, async generators stream with `for await`, streams keep backpressure, errors keep their subclasses, `AbortSignal`s propagate aborts. It works across Workers, SharedWorkers, windows/iframes, MessagePorts, WebSockets, web extensions, and anything else you can wrap in a custom `{ emit, receive }` pair, degrading gracefully to a JSON-only mode on text channels.

## Features

- **Zero runtime dependencies**: one ESM module
- **Symmetric API**: both sides call `expose()`; either side can pass functions, both can call
- **Deep type support**: functions, promises, async generators, `ReadableStream`/`WritableStream`, `MessagePort`, `AbortSignal`, `Error` subclasses, `File`/`FileList`, `Request`/`Response`, `Map`/`Set`, typed arrays, `BigInt`, `Symbol`, …
- **JSON-mode degradation**: the same value types work over text-only transports (WebSocket, extension messaging); `Date`, `Map`, typed arrays, even `NaN`/`±Infinity` survive
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
import type { Transport } from 'osra'

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

expose(api, { transport: globalThis as unknown as Transport })
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
| `key` | `'__OSRA_DEFAULT_KEY__'` | Namespacing tag that lets multiple independent osra connections share one channel. **Not authentication.** |
| `origin` | `'*'` | On window transports: sets the outbound `postMessage` target origin **and** filters inbound messages by `event.origin` |
| `name` / `remoteName` | - | Label your endpoint / only accept envelopes from a matching peer name |
| `unregisterSignal` | - | `AbortSignal` that tears the connection down (see [Lifecycle](#error-handling--lifecycle)) |
| `uuid` / `remoteUuid` | random / - | Pin instance uuids (`remoteUuid` is otherwise learned from the peer's announce); when both sides preset each other's `remoteUuid`, the announce handshake is skipped |
| `revivableModules` | - | `defaults => modules` function to add, drop, reorder, or override type-handling modules |

If multiple peers connect over the same transport, the returned promise resolves with the **first** peer's value; later peers still connect and can call your exposed value.

## Supported types

Transports are either **structured-clone** (Worker, Window, MessagePort, SharedWorker) or **JSON** (WebSocket, web extension messaging, custom transports with `isJson: true`).

| Type | Clone | JSON | Notes |
|---|---|---|---|
| JSON primitives, plain objects, arrays | ✅ | ✅ | |
| `undefined`, `NaN`, `±Infinity` | ✅ | ✅ | preserved even over JSON |
| `Date`, `BigInt`, `Map`, `Set` | ✅ | ✅ | |
| Typed arrays, `ArrayBuffer` | ✅ | ✅ | subarray views keep `byteOffset`/`length` |
| `Error` + subclasses | ✅ | ✅ | `TypeError`, `RangeError`, `AggregateError` (nested errors), `DOMException`, … with `cause` and `stack` |
| `Symbol` | ✅ | ✅ | `Symbol.for` registry symbols round-trip by key; others keep per-connection identity |
| `RegExp` | ✅ | ❌ | |
| `SharedArrayBuffer` | ✅ | ❌ | shared memory across the contexts |
| Function | ✅ | ✅ | becomes `(...args) => Promise<result>`; arguments and results recurse through the same boxing |
| `Promise` | ✅ | ✅ | |
| Async generators / async iterables | ✅ | ✅ | `next`/`return`/`throw` proxied; `for await` works; early `break` runs the source's `finally` |
| `ReadableStream` | ✅ | ✅ | pull-based backpressure; cancel reason crosses |
| `WritableStream` | ✅ | ✅ | write/close/abort with acks; sink errors reject the writer |
| `MessagePort` | ✅ | ✅ | revives as a real `MessagePort` on both transport kinds |
| `AbortSignal` | ✅ | ✅ | abort and reason propagate |
| `File` / `FileList` | ✅ | ❌ | revive as themselves via structured clone (clone transports only); `Blob` is **not** supported |
| `Request` / `Response` / `Headers` | ✅ | ✅ | streamed bodies; `Request.signal` propagates; `Response.url`/`redirected` restored; opaque status-0 revives as `Response.error()` |
| `Event` / `CustomEvent` | ✅ | ✅ | subclass fields beyond `detail` are dropped |
| `EventTarget` | ✅ | ✅ | revives as a listener-only façade: `add`/`removeEventListener` proxy to the source; you can't dispatch through it |
| Other structured-clonables (`ImageData`, `DOMRect`, `CryptoKey`, …) | ✅ | ❌ | pass through structured clone untouched |
| Transfer-only host objects (`OffscreenCanvas`, `MediaStreamTrack`, `RTCDataChannel`, …) | ✅ | ❌ | always moved to the peer |
| `ImageBitmap`, `VideoFrame`, `AudioData` | ✅ | ❌ | copied by structured clone; wrap in `transfer()` to move |
| `WeakMap` / `WeakSet`, other unclonables | ❌ | ❌ | coerce to `{}` at runtime, rejected at compile time |

## Transports

### Worker

Pass the `Worker` on the page side and `globalThis` (the `DedicatedWorkerGlobalScope`) inside the worker; see [Quick Start](#quick-start). The worker scope is detected at runtime but isn't part of the `Transport` type union, so cast it: `globalThis as unknown as Transport`.

### Window ↔ iframe

`message` events fire on the window that receives them, so each side pairs the *other* window for emit with its *own* window for receive. `origin` is applied in both directions:

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

JSON mode. `runtime.Port`, the runtime itself (`sendMessage`/`onMessage`), `onConnect`, and `onMessage` are all accepted:

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

If you accept `onConnectExternal`/`onMessageExternal`, validate senders yourself; the `MessageContext` passed to custom receive listeners exposes `sender`.

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

`transfer(value)` opts a `Transferable` (`ArrayBuffer`, `MessagePort`, streams, `ImageBitmap`, `OffscreenCanvas`, …) into move semantics: ownership transfers to the peer instead of copying. On JSON transports it silently degrades to a copy.

```ts
import { transfer } from 'osra'

const pixels = new ArrayBuffer(16_000_000)
await remote.render(transfer(pixels)) // moved - pixels is detached locally
```

## Error handling & lifecycle

- Remote functions that throw reject the caller's promise with the revived error, subclass and all.
- `expose()` rejects when the transport can't both emit and receive (`{ emit }` or `{ receive }` alone is a configuration error), and when a peer sends a malformed `init` payload (the revive error surfaces instead of hanging).
- Aborting `unregisterSignal`:
  - the pending `expose()` rejects with the abort reason,
  - a protocol `close` is sent to every connected peer and per-connection state is disposed,
  - pending RPC calls reject with `'osra: connection closed'` on **both** sides (the peer receiving `close` rejects its pending calls too),
  - proxied streams on wire-routed channels (JSON transports) are cancelled/aborted with the same error.
- Promises and streams riding real transferred `MessagePort`s on structured-clone transports live independently of the connection and survive its closure; wire-routed traffic does not.
- After aborting, calling `expose()` again on the same transport performs a fresh handshake.

```ts
const controller = new AbortController()
const remote = await expose<Api>({}, { transport: worker, unregisterSignal: controller.signal })

const pending = remote.slowCall()
controller.abort(new Error('shutting down'))
// pending rejects with 'osra: connection closed'
```

**Trust model**: `key` is namespacing, not authentication. `origin` filters window messages in both directions; set it whenever you talk across origins. Treat peers as semi-trusted: malformed payloads are handled, but DoS-hardening against hostile peers is not complete.

## Limitations

- **Circular structures throw** a `TypeError` at send time; break the cycle or restructure.
- **Shared references duplicate**: two fields pointing at the same object arrive as two copies unless wrapped with `identity()`.
- **Classes/prototypes are not preserved**: values cross as plain data; a class instance's methods are not proxied. Expose plain objects and functions.
- **Unclonable values** (`WeakMap`, `WeakSet`, exotic host objects) coerce to `{}` and fail the compile-time check.
- **One-shot bodies**: sending the same `Request`/`Response`/`ReadableStream` twice fails; the body locks at first send.
- **Generic functions collapse** in `Remote<T>`: mapped types can't preserve generic signatures.
- **Multi-peer**: only the first peer's value is accessible through the returned promise.
- **Everything is async**: sync return values still arrive as `Promise`s.

## TypeScript

`Remote<T>` is what the other side sees: functions become `(...args) => Promise<Awaited<R>>`, containers map recursively, platform objects revive as themselves.

`expose()` validates the value you pass at compile time against `Capable`, the union of everything serializable for the inferred transport (narrower on JSON transports). Failures pinpoint the offending path:

```ts
expose({ ok: async () => 1, cache: new WeakMap() }, { transport: worker })
// type error: Value type must resolve to a Capable, with `cache` identified as the bad field
```

The published declarations require **TypeScript >= 5.9** with `strict` mode.

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

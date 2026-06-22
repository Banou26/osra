# osra API reference

osra connects two JavaScript contexts over a transport. Each side calls `expose(value, { transport })` and receives the other side's value with live semantics: functions stay callable, promises settle across the boundary, streams flow, abort signals propagate.

- [expose()](#expose)
- [Remote\<T\>](#remotet)
- [Transports](#transports)
- [identity()](#identity)
- [transfer()](#transfer)
- [relay()](#relay)
- [Custom revivables](#custom-revivables)
- [Type guards](#type-guards)
- [Low-level messaging](#low-level-messaging)
- [Wire protocol](#wire-protocol)
- [Supported types](#supported-types)
- [Limitations](#limitations)

## expose()

```ts
const expose: <T = unknown>(
  value: Capable,
  options: StartConnectionsOptions & { transport: Transport },
) => Promise<Remote<T>>
```

Exposes `value` to the peer and resolves with the peer's exposed value. **Both sides call `expose()`**; there is no separate client/server entry point. A side that only consumes passes `{}`:

```ts
// worker.ts
import { expose } from 'osra'

expose({ ping: async (n: number) => n + 1 }, { transport: globalThis })
```

```ts
// main.ts
import { expose } from 'osra'

type Api = { ping: (n: number) => Promise<number> }

const worker = new Worker('./worker.js', { type: 'module' })
const api = await expose<Api>({}, { transport: worker })
await api.ping(41) // 42
```

The handshake is announce → announce-reply → init: each side broadcasts `announce`, peers reply with an addressed `announce`, then each side sends `init` carrying its boxed value. The returned promise resolves once the peer's `init` arrives and revives. With multiple peers on one transport, the promise resolves with the **first** peer's value (first wins); later peers still connect and can call into your value, but there is no public accessor for their values.

### Options (`StartConnectionsOptions`)

| Option | Type | Default | Semantics |
|---|---|---|---|
| `transport` | `Transport` | required | The channel to the peer. See [Transports](#transports). |
| `name` | `string` | - | Stamped on every outgoing envelope as `name`. |
| `remoteName` | `string` | - | Inbound filter: envelopes whose `name` differs are dropped. |
| `key` | `string` | `OSRA_DEFAULT_KEY` (`'__OSRA_DEFAULT_KEY__'`) | **Namespacing, not authentication.** Envelopes carry it under `__OSRA_KEY__`; inbound messages with a different key are ignored, so multiple independent osra connections can share one channel. |
| `origin` | `string` | `'*'` | Outbound: passed as `targetOrigin` to `window.postMessage` (windows only). Inbound: on **window** receive transports, events whose non-empty `event.origin` differs are dropped (cross-origin iframe/window filtering). Non-window transports (Worker, MessagePort, WebSocket, ServiceWorkerContainer, WebExtension, custom) are not origin-filtered; WebSocket/ServiceWorker events carry their own unrelated origins, so filtering there would be a footgun. |
| `unregisterSignal` | `AbortSignal` | - | Teardown handle, see below. |
| `revivableModules` | `(defaults: DefaultRevivableModules) => TModules` | defaults as-is | Configure the revivable module list. See [Custom revivables](#custom-revivables). |
| `uuid` | `Uuid` | `crypto.randomUUID()` | This side's identity, stamped on every envelope. Own messages looped back on the channel are ignored by uuid match. |
| `remoteUuid` | `Uuid` | - | Preset the peer's uuid to skip the announce handshake, see below. |

### `unregisterSignal` teardown

Aborting the signal:

- stops the message listener and suppresses further outbound messages
- sends a protocol `close` envelope to every tracked peer
- disposes per-connection state (port routing, identity caches, …)
- rejects the pending `expose()` promise with the signal's abort reason
- rejects in-flight RPC calls with `Error('osra: connection closed')` **on both sides**: the peer that receives `close` also tears down its connection state and rejects its own pending calls into you

If the signal is already aborted when `expose()` is called, no listener is registered at all. The internal promise is pre-caught, so fire-and-forget `expose(value, …)` (the typical server-side pattern) never surfaces an unhandled rejection on abort; awaiting callers still observe it.

One exception: promises riding a **real transferred `MessagePort`** on a structured-clone transport are entangled by the platform, not routed by osra, so they stay live independently of the connection. Wire-routed calls (functions, JSON-mode ports) always reject on connection death.

### Preset uuids (`uuid` + `remoteUuid`)

When `remoteUuid` is set, that side skips `announce` entirely and immediately sends `init` addressed at the preset uuid. **Both sides must preset**: each side's `uuid` fixed and `remoteUuid` pointing at the other:

```ts
expose(value, { transport: port1, uuid: uuidA, remoteUuid: uuidB })
const remote = await expose({}, { transport: port2, uuid: uuidB, remoteUuid: uuidA })
```

No `announce` envelope is ever emitted; `init` flows directly. A one-sided preset is not supported, but the failure is asymmetric: the non-presetting peer drops the presetting side's early `init` (untracked uuid) and its `expose()` hangs forever, while the presetting side still answers the peer's broadcast `announce`, receives the peer's `init`, and resolves.

### Errors

- `expose()` rejects immediately if the (normalized) transport cannot both emit and receive, e.g. a bare `ServiceWorker` or a custom `{ emit }` without `receive`.
- Boxing a value that cannot be serialized (e.g. a circular structure) rejects the returned promise with a `TypeError`; so does reviving a malformed/cyclic `init` payload from a peer.
- A peer's protocol `close` arriving before `init` rejects the pending promise with `Error('osra: peer closed the connection')`.

### TypeScript

The package is strict-mode; published types need **TypeScript ≥ 5.9**. The `Capable` type-level check rejects non-serializable values at the `expose()` call site with an error that pinpoints the offending path and parent object, so a `WeakMap` buried three levels deep fails at compile time, not at runtime.

## Remote\<T\>

The type of the value as seen from the far side:

| Local type | Remote type |
|---|---|
| `(...args: P) => R` | `(...args: P) => Promise<Remote<Awaited<R>>>` |
| `Promise<U>` | `Promise<Remote<U>>` |
| `AsyncIterable<U>` | `AsyncIterableIterator<Remote<U>>` |
| `Map`, `Set`, `Date`, `Error`, `RegExp`, `ArrayBuffer`, `ArrayBufferView`, `ReadableStream`, `WritableStream`, `MessagePort`, `EventTarget`, `Request`, `Response`, `Headers`, `File`, `FileList` | itself (clone transports only; `Blob` is not supported) |
| arrays / objects | mapped recursively |
| primitives | themselves |

Generic function signatures collapse: mapped types cannot preserve type parameters, so a generic remote function loses its generics in `Remote<T>`.

## Transports

| Transport | Mode | Notes |
|---|---|---|
| `Window` | clone | `origin` applies (inbound filter + outbound `targetOrigin`). |
| `Worker` | clone | |
| `DedicatedWorkerGlobalScope` | clone | Pass `globalThis` (or `self`) inside the worker. |
| `SharedWorker` | clone | Page side. Messages ride `.port` (handled internally). |
| `MessagePort` | clone | `.start()` is called internally on receive. |
| `WebSocket` | JSON | Envelopes are `JSON.stringify`ed; sends while `CONNECTING` queue until `open`. |
| `ServiceWorker` | clone | **Emit only.** |
| `ServiceWorkerContainer` | clone | **Receive only.** Combine: `{ emit: registration.active, receive: navigator.serviceWorker }`. |
| WebExtension `runtime` / `Port` / `onConnect` / `onMessage` | JSON | `runtime`/`onConnect` are identity-matched against the `browser`/`chrome` global; `Port`/`onMessage` are detected purely structurally and work without the global (lookalike objects can misclassify as these). |
| Custom `{ emit?, receive?, isJson? }` | per `isJson` / probed | See below. |

**Custom transports** are plain objects with `emit` and/or `receive`. Each may be a platform transport from the table above or a function:

```ts
type ReceiveHandler = (listener: (message: Message, context: MessageContext) => void) => void | (() => void)
type EmitHandler = (message: Message, transferables?: Transferable[]) => void
```

A function `receive` may return an unsubscribe function, called when `unregisterSignal` aborts. JSON mode is taken from `isJson` when set, otherwise probed from the embedded platform transports (`{ emit: webSocket }` is JSON-only even though the wrapper isn't).

Custom transports **must be plain objects** (`Object.prototype` or `null` prototype). Prototype-based objects with an inherited `emit` (e.g. Node `EventEmitter`s) are deliberately not detected as custom transports.

On JSON transports, values that depend on structured clone (`RegExp`, `SharedArrayBuffer`, `ImageBitmap`, …) are rejected at the type level; everything with a dedicated revivable module (`Date`, `Map`, `ArrayBuffer` via base64, functions, streams, …) still works.

## identity()

```ts
const identity: <T>(value: T) => T
```

Opt-in reference identity across the connection. By default every send produces a fresh copy; wrapping with `identity()` makes the same object revive as the **same** reference on every send, and a round-trip back to the sender resolves to the **original** object. Idempotent; primitives pass through unchanged. Per-connection caches are GC-aware (a dropped reference notifies the peer via `identity-dispose`).

```ts
import { identity } from 'osra'

const config = { mode: 'fast' }
await remote.register(identity(config))
await remote.register(identity(config)) // peer sees the same object twice
```

## transfer()

```ts
const transfer: <T>(value: T) => T
```

Opt-in **move** semantics for clonable Transferables (`ArrayBuffer`, typed-array views, `ImageBitmap`, `VideoFrame`, `AudioData`, …). The value is added to the transfer list instead of being cloned, detaching it locally. Idempotent; non-transferable inputs pass through. On JSON transports it silently degrades to a copy.

Types that structured clone cannot copy are **always moved**, with or without `transfer()`: `MessagePort`, `ReadableStream`/`WritableStream`/`TransformStream`, `OffscreenCanvas`, `MediaSourceHandle`, `MediaStreamTrack`, `MIDIAccess`, `RTCDataChannel`, WebTransport streams. A bare send still detaches them locally; `transfer()` adds nothing there.

```ts
import { transfer } from 'osra'

const buffer = new ArrayBuffer(1_000_000)
await remote.process(transfer(buffer)) // buffer is detached locally
```

## relay()

```ts
const relay: (transportA: Transport, transportB: Transport, options?: RelayOptions) => void
```

A pure wire between two transports: every osra envelope received on one side is forwarded verbatim (with its transferables re-collected) to the other, in both directions where the transports allow it. The relay never establishes a connection of its own; the endpoints handshake with each other through it. Typical use: bridging two workers, or an iframe to a worker, through a page that owns both transports.

```ts
import { relay } from 'osra'

relay(workerA, workerB, { unregisterSignal: controller.signal })
```

### `RelayOptions`

| Option | Type | Default | Semantics |
|---|---|---|---|
| `key` | `string` | `OSRA_DEFAULT_KEY` | Only envelopes with this key are forwarded. |
| `origin` | `string` | `'*'` | Default for both directions. |
| `originA` / `originB` | `string` | `origin` | Per-side origin (inbound filter from that side + outbound `targetOrigin` toward it). |
| `nameA` / `nameB` | `string` | - | Only forward envelopes from that side whose `name` matches. |
| `unregisterSignal` | `AbortSignal` | - | Stops forwarding in both directions. |

A direction is only wired when the source can receive and the destination can emit; emit-only/receive-only pairs degrade to one-way forwarding.

**Caveat: capability classes must match.** Endpoints box values for their *own* transport: on a structured-clone transport, `MessagePort`s (and values riding them) are sent as real transferred ports. Relaying such an envelope onto a JSON transport (e.g. `MessagePort → WebSocket`) destroys the embedded ports in serialization. Keep both legs in the same class: both structured-clone or both JSON.

## Custom revivables

The `revivableModules` option receives the default module list and returns the final ordered list: add modules, drop defaults, reorder, or override per-type. Order matters: the first module whose `isType` matches wins, so custom modules usually go **before** the defaults (which end in catch-all fallbacks).

```ts
type RevivableModule = {
  readonly type: string
  readonly isType: (value: unknown) => value is T
  readonly box: (value: T, context: RevivableContext) => BoxBase & { type: string }
  readonly revive: (boxed, context: RevivableContext) => T
  readonly init?: (context: RevivableContext) => void
}
```

`box` turns a matched value into a plain serializable box (spread `BoxBase` in to tag it); `revive` reconstructs it on the other side. `context` gives access to `sendMessage`/`eventTarget` for modules that need their own wire traffic, and `recursiveBox`/`recursiveRevive` (exported) handle nested values.

```ts
import type { RevivableContext, RevivableModule } from 'osra'
import { expose, BoxBase } from 'osra'

class Point {
  constructor(public x: number, public y: number) {}
  distance() {
    return Math.sqrt(this.x ** 2 + this.y ** 2)
  }
}

const pointModule = {
  type: 'point' as const,
  isType: (value: unknown): value is Point => value instanceof Point,
  box: (value: Point, _context: RevivableContext) => ({
    ...BoxBase,
    type: 'point' as const,
    x: value.x,
    y: value.y,
  }),
  revive: (value: { x: number, y: number }, _context: RevivableContext) =>
    new Point(value.x, value.y),
} as const satisfies RevivableModule

const withPoint = <TDefaults extends readonly RevivableModule[]>(defaults: TDefaults) =>
  [pointModule, ...defaults] as const

// both sides must register the same modules
expose(async (p: Point) => new Point(p.x * 2, p.y * 2), { transport, revivableModules: withPoint })

const remote = await expose<(p: Point) => Promise<Point>, ReturnType<typeof withPoint>>(
  {},
  { transport, revivableModules: withPoint },
)

const doubled = await remote(new Point(3, 4)) // a real Point instance, distance() === 10
```

Passing the module list type as the second type parameter (`ReturnType<typeof withPoint>`) teaches the `Capable` check that `Point` is now a legal value.

## Type guards

All exported from the package root:

| Guard | True for |
|---|---|
| `isTransport(v)` | anything usable as the `transport` option |
| `isEmitTransport(v)` / `isReceiveTransport(v)` | transports that can send / receive (note `ServiceWorker` is emit-only, `ServiceWorkerContainer` receive-only) |
| `assertEmitTransport(v)` / `assertReceiveTransport(v)` | throwing assertion forms |
| `isCustomTransport(v)` / `isCustomEmitTransport(v)` / `isCustomReceiveTransport(v)` | plain-object `{ emit?, receive? }` wrappers |
| `isJsonOnlyTransport(v)` / `isEmitJsonOnlyTransport(v)` / `isReceiveJsonOnlyTransport(v)` | JSON-mode transports (WebSocket, WebExtension family, `{ isJson: true }`) |
| `isWindow` / `isWorker` / `isDedicatedWorker` / `isSharedWorker` / `isServiceWorker` / `isServiceWorkerContainer` / `isWebSocket` | the respective platform objects (cross-origin-window safe) |
| `isWebExtensionRuntime` / `isWebExtensionPort` / `isWebExtensionOnConnect` / `isWebExtensionOnMessage` | WebExtension transports |
| `isOsraMessage(v)` | objects carrying the `__OSRA_KEY__` envelope field |
| `isTransferable(v)` / `isTypedArray(v)` / `isSharedArrayBuffer(v)` | value classification helpers |

## Low-level messaging

Escape hatches under the connection layer; `relay()` is built on exactly these.

```ts
const registerOsraMessageListener: (options: {
  listener: (message: Message, context: MessageContext) => void
  transport: ReceiveTransport
  remoteName?: string
  key?: string        // default OSRA_DEFAULT_KEY
  origin?: string     // default '*'
  unregisterSignal?: AbortSignal
}) => void
```

Subscribes to raw osra envelopes on any receive transport. Handles the per-transport quirks (JSON string parsing on WebSocket, `.port` indirection on SharedWorker, `MessagePort.start()`, the WebExtension listener families) and filters by `key`, `remoteName`, and `origin`. `MessageContext` is `{ port?, sender?, receiveTransport?, source?, origin? }`; WebExtension consumers using `onConnectExternal`/`onMessageExternal` must validate `context.sender` themselves.

```ts
const sendOsraMessage: (
  transport: EmitTransport,
  message: Message,
  origin?: string,            // default '*', Window targetOrigin
  transferables?: Transferable[],
) => void
```

Sends a raw envelope on any emit transport (JSON-stringifies for WebSocket and queues while `CONNECTING`; routes via `.port` for SharedWorker).

## Wire protocol

Every message is an **envelope**: base fields merged with one variant:

```ts
{ "__OSRA_KEY__": key, uuid, name? }   // base: sender identity + namespacing
```

| Variant | Shape | Meaning |
|---|---|---|
| announce | `{ type: 'announce', remoteUuid? }` | Without `remoteUuid`: broadcast presence. With: addressed reply to a specific peer. |
| close | `{ type: 'close', remoteUuid }` | Sender is tearing down its side of the connection. |
| init | `{ type: 'init', remoteUuid, data }` | The sender's boxed exposed value. |
| message | `{ type: 'message', remoteUuid, portId, data }` | Payload for a routed message port (functions, streams, JSON-mode ports all ride these). |
| message-port-close | `{ type: 'message-port-close', remoteUuid, portId }` | A routed port closed. |
| identity-dispose | `{ type: 'identity-dispose', remoteUuid, id }` | The **sender** of an `identity()`-tracked value garbage-collected the original; the receiver evicts its cached revival. (Receivers never send this; their cache holds strong references.) |

`uuid` is always the **sender**; `remoteUuid` addresses the **recipient**; peers drop variants addressed to other uuids, and drop `init`/`message` traffic from uuids they haven't completed an announce exchange with.

Non-trivial values inside `data` are **boxes**:

```ts
{ "__OSRA_BOX__": 'revivable', type: '<module type>', ...fields }
```

e.g. `{ "__OSRA_BOX__": 'revivable', type: 'date', ... }`. The constants `OSRA_KEY` (`'__OSRA_KEY__'`), `OSRA_DEFAULT_KEY`, and `OSRA_BOX` (`'__OSRA_BOX__'`) are exported.

**Trust model**: `key` is namespacing only; `origin` filters window messages both ways; beyond that, treat peers as semi-trusted: malformed payloads reject cleanly, but DoS-hardening is not complete.

## Supported types

| Type | Revives as | Notes |
|---|---|---|
| JSON data (string, number, boolean, null, plain objects, arrays) | itself | Containers mapped recursively. |
| `undefined` | `undefined` | Preserved, even on JSON transports. |
| `NaN`, `±Infinity` | itself | Preserved, even on JSON transports. |
| `Date` | `Date` | |
| `bigint` | `bigint` | |
| `RegExp` | `RegExp` | Clone transports only (rides structured clone). |
| `Map` / `Set` | `Map` / `Set` | Keys and values boxed recursively. |
| TypedArrays (`Uint8Array`, …, `BigInt64Array`, `Float16Array` where supported) | same type | Subarray views keep `byteOffset`/`length`; subclasses (Node `Buffer`) revive as the nearest standard type. |
| `ArrayBuffer` | `ArrayBuffer` | base64 on JSON transports. |
| `SharedArrayBuffer` | `SharedArrayBuffer` | Clone transports only. |
| `Error` (+ subclasses) | same subclass | `TypeError`/`RangeError`/`SyntaxError`/`ReferenceError`/`EvalError`/`URIError`, `AggregateError` with nested errors, `DOMException`; `cause` and `stack` preserved. |
| `Promise<T>` | `Promise<T>` | Settles when the source settles; rejections cross with full error fidelity. |
| Function | `(...args) => Promise<Awaited<R>>` | Args and return value boxed recursively; throws reject the promise. |
| Async generator / async iterable | `AsyncIterableIterator` | `next`/`return`/`throw` proxied; `for await` works; early `break` propagates `return()` to the source. |
| `ReadableStream` | `ReadableStream` | Pull-based backpressure; `cancel` reason crosses to the source. |
| `WritableStream` | `WritableStream` | `write`/`close`/`abort` with acks. |
| `MessagePort` | `MessagePort` | Transferred natively on clone transports; routed via `portId` on JSON. |
| `AbortSignal` | `AbortSignal` | `abort` and its `reason` propagate. |
| `File` / `FileList` | `File` / `FileList` | Revive as themselves via structured clone (clone transports only, not JSON); `File` keeps `name` + `lastModified`. `Blob` is not supported. |
| `Request` | `Request` | Headers, streamed body, `mode`/`credentials`/etc.; `signal` propagates. |
| `Response` | `Response` | Streamed body; `url`/`redirected` restored; opaque status-0 revives as `Response.error()`. |
| `Headers` | `Headers` | |
| `Event` / `CustomEvent` | `Event` / `CustomEvent` | `type`/`bubbles`/`cancelable`/`composed` + `detail` (boxed recursively). Subclass fields beyond `detail` are dropped. |
| `EventTarget` | listener-only façade | `addEventListener`/`removeEventListener` proxy to the source; events do **not** dispatch locally on the façade. |
| `symbol` | `symbol` | `Symbol.for` registry symbols round-trip via their key; others keep per-connection identity (same symbol on every send, round-trips to the original). |
| Other clonables (`ImageBitmap`, `ImageData`, …) | itself | Clone transports only, via structured clone. |
| Clonable Transferables (`VideoFrame`, `AudioData`, `ImageBitmap`, …) | itself | Cloned by default; wrap with `transfer()` to move. |
| Must-transfer types (`OffscreenCanvas`, `MediaStreamTrack`, `RTCDataChannel`, …) | itself | Always **moved** (detached locally) on every send; structured clone cannot copy them, so `transfer()` is implied. |
| Unclonables (`WeakMap`, `WeakSet`, …) | `{}` | Coerced, matching `JSON.stringify` behavior; the type-level `Capable` check flags them first. |

## Limitations

- **Circular structures throw** a `TypeError` at send time; break the cycle or restructure (e.g. send the container behind a function).
- **Shared references duplicate**: the same object appearing twice in a payload arrives as two copies unless wrapped with `identity()`.
- **Classes/prototypes are not preserved.** Values cross as plain data; a class instance's methods are not proxied. Expose plain objects and functions, or write a [custom revivable](#custom-revivables).
- **Unclonable values coerce to `{}`** at runtime (`WeakMap`, `WeakSet`, …); the compile-time `Capable` check catches them earlier.
- **Bodies lock at first send**: sending the same `Request`/`Response`/`ReadableStream` twice fails.
- **Generic function type parameters collapse** in `Remote<T>`.
- **Multi-peer**: only the first peer's value is exposed through the returned promise; later connections have no public accessor.
- **RPC is async**: synchronous return values still arrive as Promises.
- **Relay capability classes**: relaying between a structured-clone and a JSON transport breaks embedded ports; keep both legs in the same class.

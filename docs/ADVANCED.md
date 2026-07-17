# Advanced Guide

Internals, lifecycle, origin and key handling, and extension points. For the user-facing API see
[API.md](./API.md). Everything here describes the code in `src/`.

## Architecture overview

osra is three layers:

1. **Transports** (`src/utils/transport.ts`, `src/utils/type-guards.ts`): normalize any
   supported channel (Window, Worker, `DedicatedWorkerGlobalScope`, SharedWorker,
   MessagePort, WebSocket, ServiceWorker/ServiceWorkerContainer, WebExtension
   runtime/Port/onConnect/onMessage, or a custom `{ emit, receive }` pair) into two
   primitives: `sendOsraMessage(transport, envelope, origin, transferables)` and
   `registerOsraMessageListener({ listener, transport, key, remoteName, origin, unregisterSignal })`.
2. **Connections** (`src/connections/`): the handshake, per-peer connection state, and the
   envelope protocol. One `expose()` call creates one protocol instance with its own `uuid`;
   each discovered peer gets a `ConnectionContext` keyed by the peer's uuid.
3. **Revivables** (`src/revivables/`): an ordered list of modules, each owning one value
   type with `isType` / `box` / `revive` (and optionally `init` for per-connection state).

### The wire protocol

Every message is a flat envelope:

```
{ "__OSRA_KEY__": key, uuid, name? }
```

plus exactly one variant:

| variant | shape |
| --- | --- |
| announce | `{ type: 'announce', remoteUuid? }` |
| close | `{ type: 'close', remoteUuid }` |
| init | `{ type: 'init', remoteUuid, data }` |
| port message | `{ type: 'message', remoteUuid, portId, data, seq? }` |
| port close | `{ type: 'message-port-close', remoteUuid, portId, seq? }` |
| identity dispose | `{ type: 'identity-dispose', remoteUuid, id }` |

`uuid` is the sender's instance id; `remoteUuid` addresses a specific peer. Non-JSON values
inside `data` are replaced by **boxes**: plain objects of the shape
`{ "__OSRA_BOX__": 'revivable', type: '<module type>', ...fields }`.

### The box → revive walk

`recursiveBox` (`src/revivables/index.ts`) walks a value depth-first: the first module whose
`isType` matches handles it; otherwise arrays and plain objects (prototype exactly
`Object.prototype`) are descended into and anything else passes through as-is. Note that
null-prototype objects are **not** descended into; live values nested inside one are never
boxed (a function in a null-proto object throws `DataCloneError` at `postMessage` on clone
transports, or is dropped on JSON).
`recursiveRevive` mirrors it, dispatching boxes to the module with the matching `type`
string. Both walks track the current ancestor path and throw a `TypeError` on circular
structures instead of recursing forever. Already-boxed values pass through `recursiveBox`
untouched, so modules can embed pre-built boxes in their payloads.

### portId routing: one logical channel

Live values (functions, promises, streams, ports, signals, …) all reduce to MessagePort
semantics. The message-port module (`src/revivables/message-port.ts`) wire-routes a port
over the single underlying transport whenever it can't be transferred for real: each boxed
port gets a random `portId`, its traffic rides `{ type: 'message', portId, data, seq }`
envelopes, and a per-connection `Map<portId, handler>` gives O(1) dispatch.
`{ type: 'message-port-close', portId }` tears one port down without touching the rest.
Function calls are always wire-routed, and on JSON transports every live value is; on
clone transports, promises, streams, and abort signals ride real transferred
`MessageChannel` ports instead.

Every port message and port close is stamped with a monotonic per-port `seq`. The receiver
buffers out-of-order arrivals (up to 2048 per port, beyond which the port is failed closed
with a synthesized close) and delivers strictly in send order, so port traffic survives
transports with no ordering guarantee. `seq` is optional on the wire only for peers on
0.5.6 or older, whose unstamped messages bypass the buffer.

On clone transports a real `MessagePort` is transferred directly when possible; everything
else (and *everything* on JSON transports) routes via `portId`.

### EventChannel: synthetic ports

`EventChannel`/`EventPort` (`src/utils/event-channel.ts`) is an in-memory MessageChannel
look-alike (postMessage queues until `start()`, `close()` notifies the peer) that never
touches structured clone. It is used wherever a real MessageChannel can't be:

- on JSON transports, where ports can't be transferred, and
- for **every** function call channel (`src/revivables/function.ts`), even on clone
  transports, because revived live values appearing in call arguments aren't
  structured-clonable.

Synthetic ports are always wire-routed via `portId`.

## The handshake in detail

Both sides call `expose()`; there is no client/server distinction
(`src/connections/bidirectional.ts`).

1. **announce**: each side broadcasts `{ type: 'announce' }` (no `remoteUuid`).
2. **reply**: a side receiving an unaddressed announce replies
   `{ type: 'announce', remoteUuid: <sender's uuid> }`.
3. **echo + init**: a side receiving an announce addressed to itself from an untracked
   uuid echoes an announce back, registers the connection, and sends
   `{ type: 'init', remoteUuid, data: recursiveBox(value) }`. The echo is a required step
   of every handshake, not just loss recovery: the side that replied in step 2 has not yet
   built a connection, and only registers it (and sends its own init) when this addressed
   echo arrives; without it, that side would drop the incoming init as untracked and hang.
   A second addressed announce from an already-tracked uuid is recognized as the normal
   handshake echo and dropped.
4. Each side resolves its `expose()` promise by reviving the peer's `init` data.

The announce dance is loss-tolerant by design: both sides announce, and every announce a
live listener receives produces a response, so if one initial announce is dropped (e.g.
Firefox discards messages posted to a fresh module worker before its listener attaches),
the other side's announce still completes the exchange. `init` is only sent after a
bidirectional announce exchange, by which point both listeners provably exist.

The bare announce is also retried with capped exponential backoff (starting at 50 ms,
doubling to a 1 s cap) until a connection is tracked or `unregisterSignal` aborts; once
any connection exists the instance never announces again for its lifetime, so reconnecting
requires the *other* side to call `expose()` again. Only the bare announce retries.
Addressed replies, echoes, and `init` are each sent exactly once, so the covered loss
model is "peer attaches its listener late", not arbitrary message loss: a message dropped
mid-handshake while both sides are already listening can leave one side resolved and the
other pending forever.

### Preset `remoteUuid` mode

If both sides pass fixed ids, the announce phase is skipped entirely and `init` flows
immediately:

```ts
expose(apiA, { transport, uuid: uuidA, remoteUuid: uuidB })
expose(apiB, { transport, uuid: uuidB, remoteUuid: uuidA })
```

**Caveat: no loss recovery.** `init` is sent exactly once, at `expose()` time. If the
peer's listener isn't attached yet and the channel doesn't buffer, the init is lost and
that side's `expose()` hangs. Preset both sides: a one-sided preset silently half-works,
deterministically. The preset side's lone init arrives before the announcing side has
tracked its uuid, is dropped, and is never resent; the announcing side's own announce
still gets a reply, so the preset side resolves normally while the announcing side stays
pending forever, with no error anywhere. Only use this mode over channels that queue (a
`MessagePort` before `start()`) or when both ends are known to be listening.

### Handshake errors

- `expose()` rejects for transports that can't both emit and receive
  (`osra: transport must be able to both emit and receive …`).
- A malformed `init` payload (an unrevivable box) rejects `expose()` with the revive error
  instead of hanging.
- Boxing your *own* value can throw at handshake time too: circular structures reject
  `expose()` with the `TypeError` described above.
- A peer's protocol `close` arriving before the handshake resolves rejects `expose()` with
  `Error('osra: peer closed the connection')`. This is a different string from the
  `osra: connection closed` used to reject in-flight calls at teardown. A close from an
  untracked uuid is ignored and cannot reject a pending handshake.

## Lifecycle & teardown

### `unregisterSignal`

Aborting the signal after `expose()` was called is explicit local teardown
(`src/connections/index.ts`):

- the pending `expose()` promise rejects with the abort reason,
- every tracked peer is sent `{ type: 'close', remoteUuid: peer }`,
- per-connection state is disposed via the teardown registry (`src/utils/teardown.ts`),
- the transport listener is removed and further sends become no-ops.

Passing an *already-aborted* signal is different: the transport listener is never
registered, and the abort event will never fire for the internally attached reject
handler, so the returned promise stays pending forever instead of rejecting. Check
`signal.aborted` before calling `expose()`.

Disposal rejects pending **wire-routed** RPC with `Error('osra: connection closed')` on
*both* sides: the peer that receives the protocol `close` runs the same teardown, so its
in-flight calls reject too rather than hanging. A peer whose handshake never completed is
left pending (its announces go unanswered); re-calling `expose()` on the same transport
after an abort performs a fresh handshake against any still-listening peer.

### GC-driven cleanup

GC-driven cleanup uses two registries: port routing goes through the shared
`FinalizationRegistry` in `src/utils/gc-tracker.ts` (`trackGc`), while the identity module
keeps its own per-connection registry (`src/revivables/identity.ts`):

- Dropping a revived port (or anything built on one) lets GC fire a
  `message-port-close` to the origin side, which closes its local end and clears the
  routing entry. While a connection is alive the box side strong-holds its port through the
  routing map, so the registry is a safety net for the *reviving* side, not the primary
  cleanup path.
- `identity()`-tracked originals that get collected send `identity-dispose`, letting the
  peer drop its cached revived value. The receiver strong-holds every revived identity
  value in a per-connection map until that dispose arrives or the connection closes; it
  cannot shed that memory on its own, so receiver-side lifetime for identity values is
  driven by sender-side GC.
- Dropping a revived *function proxy* does **not** reject that proxy's in-flight calls;
  return ports are pinned until they settle. Pending calls reject only on connection
  teardown.

### What survives connection death

On clone transports, a real transferred `MessagePort` is a platform channel independent of
the osra envelope; it keeps working after the protocol connection dies. Concretely:
promises boxed on a clone transport ride a real transferred port and **stay pending/live**
across teardown rather than rejecting. Everything `portId`-routed (function calls always,
all live values on JSON transports, synthetic ports) dies with the connection and rejects
with `osra: connection closed`.

## Origins, keys, and senders

### `origin`: inbound and outbound

On window transports, `origin` (default `'*'`) does two things: it is the
`postMessage` `targetOrigin` for outbound envelopes, **and** inbound messages whose
`event.origin` doesn't match are dropped (`registerOsraMessageListener`):

```ts
// host page
const channel = await expose(hostApi, {
  transport: { emit: iframe.contentWindow, receive: window },
  origin: 'https://widget.example',
})

// inside the iframe
const host = await expose(widgetApi, {
  transport: { emit: window.parent, receive: window },
  origin: 'https://host.example',
})
```

Always set `origin` for cross-origin window messaging. Notes: the inbound filter runs
only when the receive transport is a Window. Events on every other transport (workers,
WebSocket, `ServiceWorkerContainer`, custom function receives, which get only key/name
filtering) are never origin-filtered, even though WebSocket and `ServiceWorkerContainer`
events do carry their own `event.origin`. Even on Window transports, an event with an
empty origin bypasses the check (sandboxed-iframe events carry the literal string
`'null'`, which a strict filter drops).

One outbound exception: the unsolicited announce beacon is posted with `targetOrigin`
`'*'` regardless of the configured `origin`. Until a freshly created cross-origin iframe
commits its document, its window still holds the initial `about:blank` (which inherits
the embedder's origin), so a strict `targetOrigin` would be dropped by the browser with a
mismatch error on every retry. The beacon carries only channel identifiers (`key`, `name`,
`uuid`) - no data - and whatever answers it must still pass the inbound origin filter.
Every other envelope (announce replies, `init`, messages, `close`) is only sent after the
peer's own message proved its committed origin, and keeps the strict `targetOrigin`.
Consequence: a wrong-origin embedder can observe the beacon's identifiers, but cannot
complete a handshake or receive any data.

### `key` is namespacing, not authentication

`key` (default `'__OSRA_DEFAULT_KEY__'`) selects a channel: it is an equality check on a
plaintext envelope field. It lets multiple independent osra connections share one
transport without cross-talk, and any party that can post on the transport can use any
key, so it does not restrict who can participate.

### WebExtension senders

When `runtime.onMessage` / `onConnect` are paired with `onMessageExternal` /
`onConnectExternal`, messages from other extensions and pages arrive on the same
listener; osra does not filter by sender. `expose()` never surfaces the `MessageContext`
(the connection layer discards it), so to filter senders either wrap the runtime in a
custom `{ receive }` transport whose handler checks `sender.id` / `sender.url` before
invoking osra's listener, or use `registerOsraMessageListener` directly, where
`ctx.sender` is populated (`ctx.port` is populated only on the `onConnect` /
`onConnectExternal` path).

### Behavior with multiple writers on one channel

Any peer that can post on the transport can complete the handshake first (first-wins, see
[Multi-peer behavior](#multi-peer-behavior) below), address existing connections by
envelope `uuid` (including sending `{ type: 'close' }` for another peer's uuid), send
boxes that fail to revive (rejecting your handshake), call the exposed value, and
generate unbounded announce or port traffic; the protocol does not rate-limit or
authenticate senders, and flood-resistance hardening is incomplete. Expose only what
every writer on the channel may call; on windows, set `origin`; in extensions, filter
senders.

## Performance notes

- Function calls (always) and all live values on JSON transports multiplex over the
  connection as `message` envelopes with O(1) per-`portId` dispatch. On clone transports,
  promises, streams, abort signals, and sent `MessagePort`s ride real transferred
  `MessagePort`s: separate platform channels that never touch the osra envelope.
- **Per-call cost**: each remote function call allocates a synthetic return channel, one
  routing entry on each side, and one boxing walk of the arguments. Entries are dropped
  when the result settles. Chatty fine-grained calls are fine; batching is still cheaper.
- **Large binary data**: on clone transports wrap buffers in `transfer()` to move instead
  of copy. Real `MessagePort`s are must-transfer and always moved; streams are **not**:
  the stream modules claim them first and replace them with a port channel, so chunks are
  proxied message-by-message with per-chunk boxing/copying (even under `transfer()`). On
  JSON transports `ArrayBuffer`/TypedArrays serialize to base64 (size and CPU overhead).
- **Repeat sends**: `identity(obj)` dedupes on the wire: the first send ships the payload
  plus an id, later sends of the same reference ship only the id, the peer reuses its
  cached revived value, and a round-trip resolves back to your original object. It saves
  wire bytes and preserves reference identity; it does not skip the sender-side boxing
  work, which runs in full on every send (the result is discarded when the id is already
  known).
- Boxing walks plain objects and arrays recursively; keep envelopes lean.

## Multi-peer behavior

The promise returned by `expose()` resolves with the **first** peer's value; later peers
still connect, can call your exposed value, and keep their own connection state, but there
is no public accessor for their values. When you need a value *per peer* (the SharedWorker
case), expose once per port instead:

```ts
// shared-worker.ts
import { expose } from 'osra'

export const api = { add: async (a: number, b: number) => a + b }

globalThis.onconnect = (event: MessageEvent) => {
  for (const port of event.ports) expose(api, { transport: port })
}
```

```ts
// page
import type { api } from './shared-worker.ts'

const worker = new SharedWorker('./shared-worker.ts', { type: 'module' })
const remote = await expose<typeof api>({}, { transport: worker })
```

The page passes the `SharedWorker` object itself; osra sends and listens on its `.port`
(and starts it) internally. The worker side gets one `expose()` (and one first-wins
promise) per connecting page.

## Writing custom transports

A custom transport is a **plain object** (`Object.prototype` or `null` prototype; this is
deliberate: prototype-based objects like Node `EventEmitter` ports have inherited `emit`
members and are intentionally not detected) with `emit` and/or `receive`, where each may be
a platform transport or a function:

```ts
type EmitHandler = (message: Message, transferables?: Transferable[]) => void
type ReceiveHandler = (
  listener: (message: Message, context: MessageContext) => void
) => void | (() => void)
```

- `emit` function: called with the ready-to-send envelope and the collected transfer list.
  Serialization is yours; osra does not stringify for function emitters.
- `receive` function: called once with osra's listener; invoke it with parsed envelope
  objects. Key and `remoteName` filtering are applied for you. Optionally return an
  unsubscribe function; it runs when `unregisterSignal` aborts.
- `isJson: true` forces JSON-safe boxing (base64 buffers, synthetic ports, no transfer).
  Without it, JSON mode is auto-detected from embedded platform transports (e.g.
  `{ emit: webSocket }` is JSON-only).
- `MessageContext` reaches only direct `registerOsraMessageListener` users (`expose()`
  discards it): `origin` and `source` on window events, `sender` for WebExtension
  listeners, `port` only on the `onConnect` path, plus `receiveTransport`. For a custom
  `receive` function, the context is whatever your own code passes to osra's listener.

A JSON transport over a MessagePort (from `tests/browser/utils.ts`):

```ts
const makeJsonTransport = (port: MessagePort) => ({
  isJson: true as const,
  emit: (message: Message) => port.postMessage(JSON.stringify(message)),
  receive: (listener: (message: Message, ctx: MessageContext) => void) => {
    port.start()
    port.addEventListener('message', event =>
      listener(JSON.parse(event.data as string) as Message, {}),
    )
  },
})
```

Mixed pairs compose platform halves, e.g. a page talking to its service worker
(`ServiceWorker` can only emit, `ServiceWorkerContainer` can only receive):

```ts
const registration = await navigator.serviceWorker.ready
const remote = await expose(value, {
  transport: { emit: registration.active!, receive: navigator.serviceWorker },
})
```

(`registration.active` is typed `ServiceWorker | null`, hence the assertion; after
`navigator.serviceWorker.ready` it is non-null.)

A transport that can't both emit and receive rejects `expose()` immediately.

There is also `relay(transportA, transportB, options?)` (`src/connections/relay.ts`): a
pure envelope forwarder between two transports: it filters by key/name/origin and copies
transfer lists but never builds a connection of its own, letting two contexts that share no
direct channel (e.g. two workers) handshake through a middleman.

## Writing custom revivables

A revivable module owns one type: `type` (unique string, identical on both sides),
`isType` (runtime guard used for boxing), `box` (value → JSON/clone-safe box), `revive`
(box → value), and optionally `init` (per-connection setup) and `Messages` (custom wire
variants; see `src/revivables/message-port.ts` for the in-tree example of both).

Preserving a class instance across the boundary (from `tests/browser/custom-revivables.ts`):

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
```

Both sides must register it; the second type parameter of `expose` carries the extended
module list into the `Capable` check:

```ts
const value = async (p: Point) => new Point(p.x * 2, p.y * 2)
expose(value, { transport, revivableModules: withPoint })

const remote = await expose<typeof value, ReturnType<typeof withPoint>>(
  {},
  { transport, revivableModules: withPoint },
)
const doubled = await remote(new Point(3, 4)) // instanceof Point, distance() === 10
```

Notes:

- **Ordering matters.** Boxing picks the *first* module whose `isType` matches, so prepend
  your module ahead of the defaults; otherwise a fallback (`clonable`, `eventTarget`, the
  `unclonable` catch-all) may claim your instances first. The default list itself is
  order-sensitive for the same reason (see the comments in `src/revivables/index.ts`).
- The `revivableModules` option is a function over the defaults; you can also drop,
  reorder, or replace built-ins, not just prepend.
- A box must spread `BoxBase` (`{ __OSRA_BOX__: 'revivable' }`) and carry only
  JSON/clone-safe fields. Nested capable values are **not** walked for you; call
  `recursiveBox`/`recursiveRevive` with the provided context. When your type needs a live
  channel, box a function or `MessagePort` through `recursiveBox` and embed the resulting
  box. (The lower-level `createRevivableChannel` helper behind promises and streams is
  not re-exported from the package root; it is reachable only via a deep
  `osra/build/revivables/message-port.js` import, which is not a stable API.)

## JSON vs clone transports

WebSocket and the WebExtension family are JSON transports; custom transports can opt in
with `isJson: true`. Everything else uses structured clone + transferables.

Preserved on JSON via boxes; these all still work: `undefined`, `NaN`/`±Infinity`, `Date`,
`BigInt`, `Map`/`Set`, TypedArrays and `ArrayBuffer` (as base64; a subarray view
round-trips its visible bytes and revives as a full-length view over a fresh buffer),
errors (the built-in classes, including `AggregateError` with nested errors and
`DOMException`, revive as themselves; any other subclass revives as base `Error` with
`name`, `message`, `stack`, and `cause` preserved), `Symbol`, and every live type
(functions, promises, async iterables, readable/writable streams, ports, `AbortSignal`,
`Request`/`Response`). Live values are wire-routed by `portId` instead of riding
transferred `MessagePort`s (a sent `MessagePort` still revives as a genuine
`MessagePort`, backed by a local `MessageChannel` half bridged over the connection):
fully functional, but they die with the connection, see above. Base64 encoding uses the
native `Uint8Array.prototype.toBase64` / `Uint8Array.fromBase64` with no polyfill or
fallback, so JSON transports require a platform that ships these methods.

Degrades or unavailable on JSON:

- `transfer()` becomes a copy; the box is marked `degraded` and skipped by the
  transfer-list walker.
- The structured-clone pass-through families are clone-only: `RegExp`, `FormData`,
  `File`/`FileList`, `ImageData`, `DataView`, DOM geometry types, `CryptoKey`,
  `FileSystemHandle`, …
  (`clonable`) and `ImageBitmap`, `OffscreenCanvas`, `VideoFrame`, `MediaStreamTrack`, …
  (`transferable`). The `Capable` type-level check excludes them on JSON transports, so
  typed code fails at compile time; there is no runtime guard, so values smuggled past
  the types (plain JS, `any`) silently JSON-coerce, typically to `{}`.
- `SharedArrayBuffer` is clone-only.

On both kinds of transport, values nothing can handle (e.g. `WeakMap`) coerce to `{}` at
runtime via the `unclonable` catch-all and are rejected at the type level by `Capable`.

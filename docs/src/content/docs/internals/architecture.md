---
title: Architecture
description: How osra's three layers (transports, connections, and revivables) turn any message channel into a live RPC connection.
---

osra is three layers: transports normalize any channel into two messaging primitives, connections run the handshake and per-peer protocol state, and revivables translate values into wire-safe boxes and back. This page maps each layer to its place in `src/` and explains the two mechanisms everything else is built on: the box → revive walk and `portId` routing.

## The three layers

1. **Transports** (`src/utils/transport.ts`, `src/utils/type-guards.ts`) normalize any supported channel (Window, Worker, `DedicatedWorkerGlobalScope`, SharedWorker, MessagePort, WebSocket, ServiceWorker/ServiceWorkerContainer, WebExtension runtime/Port/onConnect/onMessage, or a custom `{ emit, receive }` pair) into two primitives: `sendOsraMessage(transport, envelope, origin, transferables)` and `registerOsraMessageListener({ listener, transport, key, remoteName, origin, unregisterSignal })`. See [transports](/guides/transports/) for the user-facing catalogue and [low-level messaging](/reference/low-level/) for the primitives themselves.

2. **Connections** (`src/connections/`) own the handshake, per-peer connection state, and the envelope protocol. One `expose()` call creates one protocol instance with its own `uuid`; each discovered peer gets a `ConnectionContext` keyed by the peer's uuid. Envelope shapes are documented in the [wire protocol reference](/reference/wire-protocol/); how peers find each other is covered in [the handshake](/internals/handshake/).

3. **Revivables** (`src/revivables/`) are an ordered list of modules, each owning one value type with `isType` / `box` / `revive` (and optionally `init` for per-connection state). Non-JSON values inside envelope `data` are replaced by **boxes**: plain objects tagged with `__OSRA_BOX__` that name the module that owns them. You can add, drop, reorder, or override modules; see [custom revivables](/guides/custom-revivables/).

## The box → revive walk

`recursiveBox` (`src/revivables/index.ts`) walks a value depth-first: the first module whose `isType` matches handles it; otherwise arrays and plain objects (prototype exactly `Object.prototype`) are descended into, and anything else passes through as-is. `recursiveRevive` mirrors it, dispatching each box to the module with the matching `type` string.

The walk's rules have direct consequences:

- **First match wins.** Module order decides which module claims a value; this is why custom modules usually go ahead of the defaults, which end in catch-all fallbacks. See [custom revivables](/guides/custom-revivables/).
- **Null-prototype objects are not descended into.** Live values nested inside one are never boxed: a function in a null-prototype object throws `DataCloneError` at `postMessage` on clone transports, or is dropped on JSON.
- **Circular structures throw.** Both walks track the current ancestor path and throw a `TypeError` on circular structures instead of recursing forever.
- **Pre-built boxes pass through.** Already-boxed values pass through `recursiveBox` untouched, so modules can embed pre-built boxes in their payloads.

## portId routing: one logical channel

Live values (functions, promises, streams, ports, signals, …) all reduce to MessagePort semantics. The message-port module (`src/revivables/message-port.ts`) wire-routes a port over the single underlying transport whenever it can't be transferred for real: each boxed port gets a random `portId`, its traffic rides `{ type: 'message', portId, seq, data }` envelopes, and a per-connection `Map<portId, handler>` gives O(1) dispatch. `{ type: 'message-port-close', portId }` tears one port down without touching the rest. Function calls are always wire-routed, and on JSON transports every live value is; on clone transports, promises, streams, and abort signals ride real transferred `MessageChannel` ports instead.

On clone transports a real `MessagePort` is transferred directly when possible; everything else (and *everything* on [JSON transports](/internals/json-vs-clone/)) routes via `portId`. The distinction matters at teardown: wire-routed traffic dies with the connection, while real transferred ports survive it. See [lifecycle](/guides/lifecycle/).

### Ordering and routing limits

Each side stamps every outgoing port message with a monotonic per-port `seq`; the receiver buffers out-of-order arrivals and delivers along the contiguous run, so port traffic keeps its send order even on transports with no ordering guarantee (a WebExtension `runtime.sendMessage` round trip, a reordering relay). Messages that arrive before the box that revives their port are held in a pending, handler-less routing entry and replayed in order the moment the handler registers.

Three fixed caps bound this state, each with a defined failure mode:

- **Reorder buffer: 2048 entries per port.** When the buffer is full and the arrival is not the exact awaited `seq` with a live handler, the gap cannot close and the port fails closed: the buffer is cleared, the `portId` is tombstoned, and a synthesized `message-port-close` is delivered to the handler. The consumer observes an ordinary port close, not an error.
- **Pending entries: 1024 per connection.** Past the cap, an early message for an unknown `portId` is dropped silently and no entry is allocated. The port itself still works once its handler registers, because the dropped message never created routing state.
- **Tombstones: 128 closed portIds, FIFO eviction.** Closed portIds are remembered so late in-flight traffic cannot resurrect routing state. Once a tombstone is evicted, a very late message for that old `portId` allocates a fresh pending entry, bounded by the pending cap and cleared at connection teardown.

## EventChannel: synthetic ports

`EventChannel`/`EventPort` (`src/utils/event-channel.ts`) is an in-memory MessageChannel look-alike (`postMessage` queues until `start()`, `close()` notifies the peer) that never touches structured clone. It is used wherever a real MessageChannel can't be:

- on JSON transports, where ports can't be transferred, and
- for **every** function call channel (`src/revivables/function.ts`), even on clone transports, because revived live values appearing in call arguments aren't structured-clonable.

Synthetic ports are always wire-routed via `portId`.

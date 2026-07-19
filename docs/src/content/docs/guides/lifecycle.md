---
title: Errors and lifecycle
description: How errors cross the boundary, when expose() rejects, and how connections tear down explicitly or through garbage collection.
---

osra connections carry errors with full fidelity and can be torn down explicitly with an `AbortSignal` or incrementally by garbage collection. This page covers what rejects, when, and with what, and what keeps working after a connection dies.

## Remote errors

Remote functions that throw reject the caller's promise with the revived error. The built-in error classes (`Error`, `TypeError`, `RangeError`, `SyntaxError`, `ReferenceError`, `EvalError`, `URIError`, `AggregateError` with its nested errors, and `DOMException`) revive as their own class; any other subclass revives as a base `Error` with `name`, `message`, `stack`, and `cause` preserved. See [supported types](/guides/supported-types/) for the full matrix.

## When `expose()` rejects

`expose()` rejects rather than hanging: on an unusable transport (one that can't both emit and receive: a configuration error, rejected immediately), on a value that can't be boxed (circular structures reject with a `TypeError`), on a malformed peer `init` (the revive error surfaces), and on a peer `close` that arrives before its `init`. The exact errors are listed in the [expose() reference](/reference/expose/#errors).

## Teardown with `unregisterSignal`

Pass an `AbortSignal` as `unregisterSignal` to get an explicit teardown handle:

```ts twoslash
import { expose } from 'osra'
type Api = { slowCall: () => Promise<string> }
declare const worker: Worker
// ---cut---
const controller = new AbortController()
const remote = await expose<Api>({}, { transport: worker, unregisterSignal: controller.signal })

const pending = remote.slowCall()
controller.abort(new Error('shutting down'))
// pending rejects with 'osra: connection closed'
```

Aborting the signal:

- stops the message listener and suppresses further outbound messages
- sends a protocol `close` envelope to every tracked peer
- disposes per-connection state (port routing, identity caches, …)
- rejects the pending `expose()` promise with the signal's abort reason
- rejects in-flight RPC calls with `Error('osra: connection closed')` on **both** sides: the peer that receives `close` also tears down its connection state and rejects its own pending calls into you
- cancels/aborts proxied streams on wire-routed channels (JSON transports) with the same error

If the signal is already aborted when `expose()` is called, nothing starts: no listener is registered, no announce goes out, and the returned promise rejects immediately with the signal's abort reason. Teardown racing startup is therefore safe in both orders.

The internal promise is pre-caught, so fire-and-forget `expose(value, …)` (the typical server-side pattern) never surfaces an unhandled rejection on abort; awaiting callers still observe it.

## GC-driven cleanup

Beyond explicit teardown, unused resources are reclaimed through `FinalizationRegistry`-based tracking:

- Dropping a revived port (or anything built on one) lets GC fire a `message-port-close` to the origin side, which closes its local end and clears the routing entry. While a connection is alive the box side strong-holds its port through the routing map, so the registry is a safety net for the *reviving* side, not the primary cleanup path.
- [`identity()`](/guides/identity-and-transfer/)-tracked originals that get collected send `identity-dispose`, letting the peer drop its cached revived value.
- Dropping a revived *function proxy* does **not** reject that proxy's in-flight calls; return ports are pinned until they settle. Pending calls reject only on connection teardown.

## Closing routed ports

Wire-routed ports (synthetic `EventPort`s always, real `MessagePort`s on JSON transports) close asymmetrically:

- Calling `close()` on a routed **real** `MessagePort` is local only: osra attaches no close listener on the routing path, so no `message-port-close` is sent. The peer's end is released by GC of your endpoint, by connection teardown, or by an application-level signal you send yourself.
- Synthetic `EventPort`s do propagate an explicit `close()`: the wire close goes out immediately and the peer's end observably closes.
- The `close` event you see on a routed port is dispatched by osra itself, on both ends, so close listeners work even where the platform lacks a native `MessagePort` close event.
- Reviving an already-closed `portId` does not throw: you get a working-shaped port whose synthesized `close` fires on a later macrotask, so listeners attached right after the port is delivered still observe the closure.

## What survives connection death

On structured-clone transports, a real transferred `MessagePort` is a platform channel independent of the osra envelope; it keeps working after the protocol connection dies. Concretely: promises boxed on a clone transport ride a real transferred port and **stay pending/live** across teardown rather than rejecting.

Everything `portId`-routed (function calls always, all live values on JSON transports, synthetic ports) dies with the connection and rejects with `osra: connection closed`. See [JSON vs clone transports](/internals/json-vs-clone/) for which values ride which channel.

## Reconnecting after teardown

A peer whose handshake never completed is left pending (its announces go unanswered). After aborting, calling `expose()` again on the same transport performs a fresh [handshake](/internals/handshake/) against any still-listening peer.

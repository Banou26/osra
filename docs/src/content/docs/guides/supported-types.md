---
title: Supported types
description: Every value type osra can send across a connection, what it revives as, and how availability differs between structured-clone and JSON transports.
---

Transports come in two kinds: **structured-clone** (Worker, Window, MessagePort, SharedWorker) and **JSON** (WebSocket, web extension messaging, custom transports with `isJson: true`). Most types work on both; a few depend on structured clone and are clone-only. See [JSON vs clone transports](/internals/json-vs-clone/) for how the two modes differ under the hood.

## Type table

| Type | Revives as | Clone | JSON | Notes |
|---|---|---|---|---|
| JSON data (string, number, boolean, null, plain objects, arrays) | itself | ✅ | ✅ | Containers mapped recursively. |
| `undefined` | `undefined` | ✅ | ✅ | Preserved, even on JSON transports. |
| `NaN`, `±Infinity` | itself | ✅ | ✅ | Preserved, even on JSON transports. |
| `Date` | `Date` | ✅ | ✅ | |
| `bigint` | `bigint` | ✅ | ✅ | |
| `Map` / `Set` | `Map` / `Set` | ✅ | ✅ | Keys and values boxed recursively. |
| TypedArrays (`Uint8Array`, …, `BigInt64Array`, `Float16Array` where supported) | same type | ✅ | ✅ | Subarray views round-trip their visible bytes: the revived view is full-length over a fresh buffer (`byteOffset` 0, element `length` preserved). Subclasses (Node `Buffer`) revive as the nearest standard type. `Float16Array` crosses only when both platforms ship it; a receiver without it rejects with `Error('Unknown typed array type')`. |
| `ArrayBuffer` | `ArrayBuffer` | ✅ | ✅ | base64 on JSON transports. |
| `RegExp` | `RegExp` | ✅ | ❌ | Rides structured clone. |
| `SharedArrayBuffer` | `SharedArrayBuffer` | ✅ | ❌ | Shared memory across the contexts. |
| `Error` (+ subclasses) | see note | ✅ | ✅ | Built-in subclasses revive as themselves; custom subclasses revive as base `Error` with `name` preserved. See [Error fidelity](#error-fidelity). |
| `Promise<T>` | `Promise<T>` | ✅ | ✅ | Settles when the source settles; rejections cross with full error fidelity. |
| Function | `(...args) => Promise<Awaited<R>>` | ✅ | ✅ | Args and return value boxed recursively; throws reject the promise. |
| Async generator / async iterable | `AsyncIterableIterator` | ✅ | ✅ | `next`/`return`/`throw` proxied; `for await` works; early `break` propagates `return()` to the source. |
| `ReadableStream` | `ReadableStream` | ✅ | ✅ | Proxied chunk-by-chunk with credit-window backpressure; `cancel` reason crosses to the source. |
| `WritableStream` | `WritableStream` | ✅ | ✅ | `write`/`close`/`abort` with acks; sink errors reject the writer with a plain `Error` carrying only the message string. |
| `TransformStream` | itself | ✅ | ❌ | Always **moved** (structured clone cannot copy it). Not proxied like `ReadableStream`/`WritableStream`: the native stream transfers to the peer and detaches locally on every send. |
| `MessagePort` | `MessagePort` | ✅ | ✅ | Transferred natively on clone transports; routed via `portId` on JSON. |
| `AbortSignal` | `AbortSignal` | ✅ | ✅ | `abort` and its `reason` propagate asynchronously; see [Live values](#live-values). |
| `Blob` / `File` / `FileList` | `Blob` / `File` / `FileList` | ✅ | ❌ | Revive as themselves via structured clone; `File` keeps `name` + `lastModified`. See [Blob](#blob) for the JSON-transport story. |
| `Request` | `Request` | ✅ | ✅ | Headers, streamed body, `mode`/`credentials`/etc.; `signal` propagates. See [Request and Response fidelity](#request-and-response-fidelity). |
| `Response` | `Response` | ✅ | ✅ | Streamed body; `url`/`redirected` restored; opaque status-0 revives as `Response.error()`. See [Request and Response fidelity](#request-and-response-fidelity). |
| `Headers` | `Headers` | ✅ | ✅ | |
| `Event` / `CustomEvent` | `Event` / `CustomEvent` | ✅ | ✅ | `type`/`bubbles`/`cancelable`/`composed` + `detail` (boxed recursively). Subclass fields beyond `detail` are dropped. |
| `EventTarget` | listener-only façade | ✅ | ✅ | See [EventTarget façades](#eventtarget-façades). |
| `symbol` | `symbol` | ✅ | ✅ | See [Symbol semantics](#symbol-semantics). |
| Other structured-clonables (`ImageData`, `DOMRect`, `CryptoKey`, …) | itself | ✅ | ❌ | Pass through structured clone untouched. |
| Clonable Transferables (`ImageBitmap`, `VideoFrame`, `AudioData`, …) | itself | ✅ | ❌ | Copied by structured clone; wrap with `transfer()` to move. |
| Must-transfer types (`OffscreenCanvas`, `MediaStreamTrack`, `RTCDataChannel`, …) | itself | ✅ | ❌ | Always **moved** to the peer. See [Must-transfer types](#must-transfer-types). |
| Unclonables (`WeakMap`, `WeakSet`, …) | `{}` | ❌ | ❌ | Coerced at runtime, rejected at compile time. See [Unclonables](#unclonables-coerce-to-). |

## Live values

Functions, promises, async iterables, streams, and abort signals don't cross as data; they cross as live proxies whose traffic is routed back to the original. All of them work on both transport kinds.

**Functions** become `(...args) => Promise<Awaited<R>>` on the peer. Arguments and results recurse through the same boxing as everything else, so you can pass callbacks to callbacks; throws reject the caller's promise.

**Promises** settle when the source settles. Rejections cross with full error fidelity.

**Async generators and async iterables** revive as `AsyncIterableIterator`: `next`/`return`/`throw` are proxied, `for await` works, and an early `break` on the consuming side propagates `return()` to the source so its `finally` blocks run. Iteration state is captured at send time: boxing calls `[Symbol.asyncIterator]()` immediately, and a generator object returns itself from that method, so sending the same generator twice shares (and advances) one cursor. Send a fresh generator per consumer, or an async iterable whose `[Symbol.asyncIterator]` creates a new iterator each time. Each iteration step is one full RPC round trip with no batching or readahead; for throughput-sensitive pipelines, prefer `ReadableStream` and its credit window.

**`ReadableStream`** is proxied chunk-by-chunk with credit-window backpressure: the consumer grants credit, the source pushes chunks up to the window, and a slow consumer stalls the producer; a `cancel` reason crosses back to the source. The window starts at 8 chunks and adapts between 2 and 64 against a 4 MiB byte budget (streams of unmeasurable chunks, such as plain objects, stay at 8). Reviving a stream grants the initial window immediately, so the producer reads up to 8 chunks before your first `read()` call. Chunks delivered before an error or end are always readable before the terminal surfaces. A producer that pushes past its granted window fails the stream with `Error('osra: stream exceeded its credit window')` and, uniquely among the failure paths, discards delivered-but-unread chunks.

**`WritableStream`** proxies `write`/`close`/`abort` with acks, one operation in flight at a time, so each write costs one round trip and the remote sink's backpressure paces the sender. Sink errors reject the writer with a plain `Error` carrying only the original message string; the error class and extra properties do not cross.

**`AbortSignal`** revives as the signal of a fresh controller. A signal already aborted at send time revives synchronously aborted, with its reason; otherwise abort propagates asynchronously, so the revived signal still reads `aborted === false` until the wire message lands. Connection teardown closes the channel but never aborts a revived signal, so don't use a remote signal to detect connection death; use `unregisterSignal` or call rejections instead (see [Lifecycle](/guides/lifecycle/)).

Streams lock at send time: boxing calls `getReader()`/`getWriter()` immediately, even if the peer never consumes the stream. Sending the same `ReadableStream`, or a `Request`/`Response` whose body has already been sent, twice fails; see [Limitations](/reference/limitations/).

## Error fidelity

The built-in error classes revive as themselves: `Error`, `TypeError`, `RangeError`, `SyntaxError`, `ReferenceError`, `EvalError`, `URIError`, `AggregateError` (with its nested errors), and `DOMException` all come back as their own class, with `cause` and `stack` preserved (`DOMException` keeps its `stack` but loses `cause`). Any other `Error` subclass revives as base `Error` with `name`, `message`, `stack`, and `cause` preserved, so it is `instanceof Error` but not `instanceof` your subclass. A remote function that throws rejects the caller's promise with the revived error.

## Request and Response fidelity

`Request` and `Response` revive with their headers, status fields, and streamed bodies (bodies ride the same credit-window protocol as `ReadableStream`). A few fields do not survive the trip: `Response.type` is not carried (revived responses report `'default'`, or `'error'` for a status-0 box), and the restored `url`/`redirected` are own-property shadows that `response.clone()` silently loses. A `mode: 'navigate'` `Request` revives with the constructor's default mode (`'navigate'` is not constructible via `RequestInit`), and `destination`/`priority`/`duplex` are not carried; a streaming body always revives with `duplex: 'half'`.

## Symbol semantics

`Symbol.for` registry symbols round-trip via their key, so both sides see the same registered symbol. Other symbols keep per-connection identity: the same symbol revives as the same symbol on every send, and round-trips back to the original.

## EventTarget façades

An `EventTarget` revives as a **listener-only façade**: `addEventListener`/`removeEventListener` proxy to the source target, so you can subscribe to its events remotely. Calling `dispatchEvent` on the façade is inert: it neither fires your local listeners nor reaches the source. Event flow is strictly source to façade.

Subscribing is fire-and-forget: the `addEventListener` RPC reaches the source asynchronously with no acknowledgment, so an event the source dispatches right after you subscribe can be missed; if the first event matters, have the source confirm registration through a normal call. When a façade is garbage-collected, one cleanup RPC removes every listener it registered on the source, so hold a reference to the façade for as long as its subscriptions must live.

## Must-transfer types

Some host objects (`OffscreenCanvas`, `MediaStreamTrack`, `RTCDataChannel`, `MediaSourceHandle`, `MIDIAccess`, and friends) can't be copied by structured clone at all, so they are always **moved** to the peer, detached locally on every send, whether or not you wrap them in `transfer()`. Clonable Transferables like `ImageBitmap`, `VideoFrame`, and `AudioData` are copied by default and only moved when wrapped; see [identity() and transfer()](/guides/identity-and-transfer/).

## Blob

`Blob` is clone-only, like `File` (its subclass): on structured-clone transports it rides structured clone and revives as itself, synchronously. JSON transports have no synchronous encoding for the bytes (`blob.arrayBuffer()` is async), so there the compile-time `Capable` check rejects it at the `expose()` call site, and a value that gets past the types throws `TypeError('osra: Blob is only supported on structured-clone transports, send an ArrayBuffer or Uint8Array instead')`, rejecting the call whether the Blob was an argument or a return value. On JSON transports, send an `ArrayBuffer` or `Uint8Array` instead.

History: 0.5.x supported `Blob` on every transport by shipping the bytes through an async box, at the cost of `Remote<Blob>` being `Promise<Blob>`. 0.6.0 removed it entirely; clone-transport support later returned as the synchronous pass-through described above.

## Unclonables coerce to `{}`

Values nothing can handle (`WeakMap`, `WeakSet`, exotic host objects) coerce to `{}` at runtime, matching `JSON.stringify` behavior. You shouldn't hit this in practice: the compile-time `Capable` check rejects them at the `expose()` call site with the offending path pinpointed. See [TypeScript](/reference/typescript/).

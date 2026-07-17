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
| TypedArrays (`Uint8Array`, …, `BigInt64Array`, `Float16Array` where supported) | same type | ✅ | ✅ | Subarray views keep `byteOffset`/`length`; subclasses (Node `Buffer`) revive as the nearest standard type. |
| `ArrayBuffer` | `ArrayBuffer` | ✅ | ✅ | base64 on JSON transports. |
| `RegExp` | `RegExp` | ✅ | ❌ | Rides structured clone. |
| `SharedArrayBuffer` | `SharedArrayBuffer` | ✅ | ❌ | Shared memory across the contexts. |
| `Error` (+ subclasses) | same subclass | ✅ | ✅ | See [Error fidelity](#error-fidelity). |
| `Promise<T>` | `Promise<T>` | ✅ | ✅ | Settles when the source settles; rejections cross with full error fidelity. |
| Function | `(...args) => Promise<Awaited<R>>` | ✅ | ✅ | Args and return value boxed recursively; throws reject the promise. |
| Async generator / async iterable | `AsyncIterableIterator` | ✅ | ✅ | `next`/`return`/`throw` proxied; `for await` works; early `break` propagates `return()` to the source. |
| `ReadableStream` | `ReadableStream` | ✅ | ✅ | Proxied chunk-by-chunk with credit-window backpressure; `cancel` reason crosses to the source. |
| `WritableStream` | `WritableStream` | ✅ | ✅ | `write`/`close`/`abort` with acks; sink errors reject the writer. |
| `MessagePort` | `MessagePort` | ✅ | ✅ | Transferred natively on clone transports; routed via `portId` on JSON. |
| `AbortSignal` | `AbortSignal` | ✅ | ✅ | `abort` and its `reason` propagate. |
| `File` / `FileList` | `File` / `FileList` | ✅ | ❌ | Revive as themselves via structured clone; `File` keeps `name` + `lastModified`. `Blob` is **not** supported. |
| `Request` | `Request` | ✅ | ✅ | Headers, streamed body, `mode`/`credentials`/etc.; `signal` propagates. |
| `Response` | `Response` | ✅ | ✅ | Streamed body; `url`/`redirected` restored; opaque status-0 revives as `Response.error()`. |
| `Headers` | `Headers` | ✅ | ✅ | |
| `Event` / `CustomEvent` | `Event` / `CustomEvent` | ✅ | ✅ | `type`/`bubbles`/`cancelable`/`composed` + `detail` (boxed recursively). Subclass fields beyond `detail` are dropped. |
| `EventTarget` | listener-only façade | ✅ | ✅ | See [EventTarget façades](#eventtarget-façades). |
| `symbol` | `symbol` | ✅ | ✅ | See [Symbol semantics](#symbol-semantics). |
| Other structured-clonables (`ImageData`, `DOMRect`, `CryptoKey`, …) | itself | ✅ | ❌ | Pass through structured clone untouched. |
| Clonable Transferables (`ImageBitmap`, `VideoFrame`, `AudioData`, …) | itself | ✅ | ❌ | Copied by structured clone; wrap with `transfer()` to move. |
| Must-transfer types (`OffscreenCanvas`, `MediaStreamTrack`, `RTCDataChannel`, …) | itself | ✅ | ❌ | Always **moved** to the peer. See [Must-transfer types](#must-transfer-types). |
| Unclonables (`WeakMap`, `WeakSet`, …) | `{}` | ❌ | ❌ | Coerced at runtime, rejected at compile time. See [Unclonables](#unclonables-coerce-to-). |

## Live values

Functions, promises, async iterables, and streams don't cross as data; they cross as live proxies whose traffic is routed back to the original. All of them work on both transport kinds.

**Functions** become `(...args) => Promise<Awaited<R>>` on the peer. Arguments and results recurse through the same boxing as everything else, so you can pass callbacks to callbacks; throws reject the caller's promise.

**Promises** settle when the source settles. Rejections cross with full error fidelity.

**Async generators and async iterables** revive as `AsyncIterableIterator`: `next`/`return`/`throw` are proxied, `for await` works, and an early `break` on the consuming side propagates `return()` to the source so its `finally` blocks run.

**`ReadableStream`** is proxied with credit-window backpressure (the consumer grants credit and the source pushes chunks up to the window, so a slow consumer stalls the producer), and a `cancel` reason crosses back to the source. **`WritableStream`** proxies `write`/`close`/`abort` with acks, and sink errors reject the writer. Note that a stream's body locks at first send: sending the same `ReadableStream` (or `Request`/`Response`) twice fails; see [Limitations](/reference/limitations/).

## Error fidelity

Errors revive as their own subclass: `TypeError`, `RangeError`, `SyntaxError`, `ReferenceError`, `EvalError`, `URIError`, `AggregateError` (with its nested errors), and `DOMException` all come back as themselves, with `cause` and `stack` preserved. A remote function that throws rejects the caller's promise with the revived error, subclass and all.

## Symbol semantics

`Symbol.for` registry symbols round-trip via their key, so both sides see the same registered symbol. Other symbols keep per-connection identity: the same symbol revives as the same symbol on every send, and round-trips back to the original.

## EventTarget façades

An `EventTarget` revives as a **listener-only façade**: `addEventListener`/`removeEventListener` proxy to the source target, so you can subscribe to its events remotely. Events do not dispatch locally on the façade, and you can't dispatch through it back to the source.

## Must-transfer types

Some host objects (`OffscreenCanvas`, `MediaStreamTrack`, `RTCDataChannel`, `MediaSourceHandle`, `MIDIAccess`, and friends) can't be copied by structured clone at all, so they are always **moved** to the peer, detached locally on every send, whether or not you wrap them in `transfer()`. Clonable Transferables like `ImageBitmap`, `VideoFrame`, and `AudioData` are copied by default and only moved when wrapped; see [identity() and transfer()](/guides/identity-and-transfer/).

## Unclonables coerce to `{}`

Values nothing can handle (`WeakMap`, `WeakSet`, exotic host objects) coerce to `{}` at runtime, matching `JSON.stringify` behavior. You shouldn't hit this in practice: the compile-time `Capable` check rejects them at the `expose()` call site with the offending path pinpointed. See [TypeScript](/reference/typescript/).

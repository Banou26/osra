---
title: Supported types
description: What you can send across a connection, and which types need a structured-clone transport.
---

Almost every platform type crosses a connection. The ones that do not are rejected at compile time rather than at runtime.

The `Clone` and `JSON` columns are the two [transport modes](/guides/transports/). Clone covers workers, windows and ports, JSON covers WebSockets and extension messaging.

| Type | Clone | JSON | Notes |
|---|---|---|---|
| Strings, numbers, booleans, `null`, plain objects, arrays | ✅ | ✅ | |
| `undefined`, `NaN`, `±Infinity` | ✅ | ✅ | Kept intact on JSON too, where `JSON.stringify` would lose them |
| `Date` | ✅ | ✅ | |
| `bigint` | ✅ | ✅ | |
| `Map`, `Set` | ✅ | ✅ | Keys and values go through the same treatment |
| `ArrayBuffer`, `Int8Array`, `Uint8Array`, `Uint8ClampedArray`, `Int16Array`, `Uint16Array`, `Int32Array`, `Uint32Array`, `Float16Array`, `Float32Array`, `Float64Array`, `BigInt64Array`, `BigUint64Array` | ✅ | ✅ | base64 encoded on JSON |
| `Error` and subclasses | ✅ | ✅ | Built-in classes keep their class, your own become a plain `Error` |
| `symbol` | ✅ | ✅ | `Symbol.for` keeps its key, `Symbol()` keeps its identity |
| Function | ✅ | ✅ | Becomes `(...args) => Promise<result>`, arguments and results included |
| `Promise` | ✅ | ✅ | |
| Async generators and async iterables | ✅ | ✅ | |
| `ReadableStream`, `WritableStream` | ✅ | ✅ | Proxied chunk by chunk, not moved |
| `MessagePort` | ✅ | ✅ | |
| `AbortSignal` | ✅ | ✅ | |
| `Request`, `Response`, `Headers` | ✅ | ✅ | Bodies stream |
| `Event`, `CustomEvent` | ✅ | ✅ | The `Event` subclass is not preserved |
| `EventTarget` | ✅ | ✅ | Arrives as a listener-only façade |
| `Blob`, `File`, `FileList` | ✅ | ❌ | Send an `ArrayBuffer` on JSON |
| `RegExp`, `DataView` | ✅ | ❌ | |
| `SharedArrayBuffer` | ✅ | ❌ | Stays shared memory across both contexts |
| `TransformStream` | ✅ | ❌ | Always moved, never proxied |
| Other clonables (`ImageData`, `DOMRect`, `CryptoKey`, `FormData`, …) | ✅ | ❌ | Handed to structured clone untouched |
| Transferable host objects (`ImageBitmap`, `VideoFrame`, `AudioData`, `OffscreenCanvas`, `MediaStreamTrack`, …) | ✅ | ❌ | Copied by default, [`transfer()`](/guides/identity-and-transfer/) to move |
| `WeakMap`, `WeakSet`, other unclonables | ❌ | ❌ | |

Anything not listed can be added with a [custom revivable](/guides/custom-revivables/).

## Errors

The built-in error classes come back as themselves: `Error`, `TypeError`, `RangeError`, `SyntaxError`, `ReferenceError`, `EvalError`, `URIError`, `AggregateError` with its nested errors, and `DOMException`. `message`, `stack` and `cause` all survive, except that `DOMException` drops `cause`.

Your own subclasses become a plain `Error` with the same `name`, `message`, `stack` and `cause`. So it is `instanceof Error`, but not `instanceof YourError`. Check `error.name` if you need to tell them apart.

## Symbols

A registry symbol (`Symbol.for('a')`) crosses by key, so both sides end up with the exact same symbol. Any other symbol keeps its identity per connection: send it twice and the peer sees one symbol both times, send it back and you get your original.

## Typed arrays

A view over part of a buffer ships only the part you can see. It arrives full length over a fresh buffer, so `byteOffset` is 0 and the length is preserved:

```ts
const view = new Uint8Array(buffer, 8, 4)
// arrives as a 4-byte Uint8Array with byteOffset 0
```

Subclasses (Node's `Buffer`, for example) come back as the nearest standard type. `Float16Array` only crosses when both sides have it.

## Blob

`Blob` and `File` ride structured clone, which is why they are clone only. JSON has no way to read their bytes without going async, so osra rejects them at the `expose()` call site and throws a `TypeError` if one slips through at runtime. Send an `ArrayBuffer` or a `Uint8Array` instead.

## Events

An `Event` carries `type`, `bubbles`, `cancelable` and `composed`, and a `CustomEvent` also carries `detail`. Anything a subclass adds is dropped, so a `MessageEvent` arrives as an `Event` without its `data`. Send the payload yourself if you need it.

## EventTarget

An `EventTarget` arrives as a façade you can listen on. `addEventListener` and `removeEventListener` reach through to the real target, so you get its events remotely.

That is all it does. Calling `dispatchEvent` on the façade does nothing, events only flow from the source outward. Subscribing is also fire and forget: the call reaches the source asynchronously, so an event fired immediately after you subscribe can be missed.

Hold on to the façade for as long as you want its events. When it gets garbage collected, osra removes every listener it registered on the source.

## Request and Response

Headers, status, and streamed bodies all survive. A `Response.url` and `redirected` are restored too, although `response.clone()` quietly loses them again, and a status 0 response comes back as `Response.error()`.

A few `Request` fields do not carry: `destination`, `priority` and `duplex`, and `mode: 'navigate'` falls back to the default mode because it cannot be reconstructed. A streamed body always revives with `duplex: 'half'`.

## Unclonables

`WeakMap`, `WeakSet` and exotic host objects have nothing to send. At runtime they turn into `{}`, matching what `JSON.stringify` does.

You should never see that happen, because they are rejected while you type, with the path to the offending value in the error. See [TypeScript](/reference/typescript/).

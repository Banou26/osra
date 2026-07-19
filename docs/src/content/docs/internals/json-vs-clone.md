---
title: JSON vs clone transports
description: What survives, degrades, or disappears when osra runs over a text-only channel instead of structured clone.
---

WebSocket and the WebExtension family are JSON transports; custom transports can opt in with `isJson: true`. Everything else uses structured clone + transferables. This page details exactly what changes in JSON mode; for the transport catalogue see [transports](/guides/transports/), and for opting a custom channel into JSON mode see [custom transports](/guides/custom-transports/).

## Preserved on JSON via boxes

These all still work over a text-only channel: `undefined`, `NaN`/`±Infinity`, `Date`, `BigInt`, `Map`/`Set`, TypedArrays and `ArrayBuffer` (as base64), errors (built-ins revive as their own class, other subclasses as base `Error`; see [supported types](/guides/supported-types/)), `Symbol`, and every live type (functions, promises, async iterables, readable/writable streams, ports, `AbortSignal`, `Request`/`Response`).

Live values ride synthetic [`EventChannel` ports](/internals/architecture/) instead of transferred `MessagePort`s: fully functional, but wire-routed, so they die with the connection. See [lifecycle](/guides/lifecycle/) for what survives connection death.

## Degrades or unavailable on JSON

- [`transfer()`](/reference/transfer/) becomes a copy; the box is marked `degraded` and skipped by the transfer-list walker.
- The structured-clone pass-through families are clone-only: `RegExp`, `FormData`, `File`/`FileList`, `ImageData`, `DataView`, DOM geometry types, `CryptoKey`, `FileSystemHandle`, … (`clonable`), `Blob` (`blob`), and `ImageBitmap`, `OffscreenCanvas`, `VideoFrame`, `MediaStreamTrack`, … (`transferable`). The `Capable` type-level check excludes them on JSON transports, so typed code fails at compile time; there is mostly no runtime guard, so values smuggled past the types silently JSON-coerce, typically to `{}` (`Blob` is the exception: it throws a `TypeError` instead of coercing).
- `SharedArrayBuffer` is clone-only.
- **Platform requirement for binary data**: base64 encoding of `ArrayBuffer` and typed arrays uses the native `Uint8Array.prototype.toBase64` and `Uint8Array.fromBase64` methods, with no fallback. These are recent additions across engines; on a runtime that lacks them, sending or receiving a buffer over a JSON transport throws. Polyfill the two methods yourself or keep buffers off JSON transports when targeting older runtimes.

## Unclonables fail on both kinds

On both kinds of transport, values nothing can handle (e.g. `WeakMap`) coerce to `{}` at runtime via the `unclonable` catch-all and are rejected at the type level by `Capable`; see the [TypeScript reference](/reference/typescript/). The full per-type matrix for both transport kinds is in [supported types](/guides/supported-types/).

---
title: "transfer()"
description: "Opt a Transferable into move semantics: ownership transfers to the peer instead of copying, detaching the value locally."
---

`transfer(value)` opts a clonable `Transferable` into **move** semantics: the value is added to the transfer list instead of being cloned, so ownership transfers to the peer and the value is detached locally.

## Signature

```ts
const transfer: <T>(value: T) => T
```

`transfer()` is idempotent, and non-transferable inputs pass through.

## Move semantics

Clonable Transferables (`ArrayBuffer`, typed-array views, `ImageBitmap`, `VideoFrame`, `AudioData`, …) are copied by structured clone by default. Wrapping one with `transfer()` moves it instead: the peer receives the original, and your local value is detached.

```ts twoslash
import type { Remote } from 'osra'
type Api = { process: (buffer: ArrayBuffer) => Promise<void> }
declare const remote: Remote<Api>
// ---cut---
import { transfer } from 'osra'

const buffer = new ArrayBuffer(1_000_000)
await remote.process(transfer(buffer)) // buffer is detached locally
```

Moving large buffers avoids the copy entirely; see [performance](/guides/performance/) for when this matters.

Detachment applies to bare `ArrayBuffer`s and to views that cover their whole buffer (`byteOffset` 0, full length). A subarray view is boxed by copying just its visible window first, and the copy is what moves: the sender's buffer is **not** detached, and the revived view is a fresh full-length view (`byteOffset` 0) over exactly the windowed bytes. There is no zero-copy move for a partial view: `transfer()` on a subarray already ships a copy of just the window. To transfer without copying, produce the data in its own dedicated buffer and transfer that whole buffer.

## JSON transports

On [JSON transports](/internals/json-vs-clone/) there is no transfer list, so `transfer()` silently degrades to a copy.

## Always-moved types

Types that structured clone cannot copy are **always moved**, with or without `transfer()`:

- `MessagePort`
- `TransformStream`
- `OffscreenCanvas`
- `MediaSourceHandle`
- `MediaStreamTrack`
- `MIDIAccess`
- `RTCDataChannel`
- WebTransport streams

A bare send still detaches them locally; `transfer()` adds nothing there.

## Streams are proxied, not moved

`ReadableStream` and `WritableStream` are never transferred natively: their revivable modules claim them ahead of the transfer machinery and proxy them over a routed channel, chunk by chunk, on clone and JSON transports alike. Sending locks the source (a reader/writer is acquired) rather than detaching it, and `transfer()` is a no-op on them; see [performance](/guides/performance/) for the implications on large binary data. `TransformStream` has no proxy module, so it rides native structured-clone transfer (clone transports only).

## See also

- [Identity and transfer](/guides/identity-and-transfer/): when to reach for `transfer()` versus [`identity()`](/reference/identity/)
- [Supported types](/guides/supported-types/): the full type matrix across clone and JSON transports

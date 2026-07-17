---
title: "identity() and transfer()"
description: Opt out of osra's default copy semantics. Preserve reference identity across the connection with identity(), or move Transferables zero-copy with transfer().
---

By default, every send produces an independent copy of the value on the peer. `identity()` and `transfer()` are the two opt-outs: `identity()` preserves reference identity across the connection, and `transfer()` moves ownership of a `Transferable` instead of copying it.

## Default: everything copies

Without a wrapper, each send is a fresh copy, including the return trip. If the peer receives a revived value and passes it back *bare*, it arrives as yet another copy, so the returning side must re-wrap it. Two fields pointing at the same object also arrive as two copies (see [Limitations](/reference/limitations/)).

## `identity()`: reference-preserving sends

`identity(value)` preserves reference identity across the connection:

- Sending the same wrapped value twice revives as the **same object** on the peer.
- When the peer wraps the revived object in `identity()` and sends it back, you receive your **original reference** (`===`).

```ts twoslash
declare const worker: Worker
// ---cut---
import { expose, identity } from 'osra'

const settings = { theme: 'dark' }
expose({
  getSettings: async () => identity(settings),
  saveSettings: async (saved: typeof settings) => {
    // when the remote sends back identity(saved): saved === settings
  },
}, { transport: worker })
```

The per-connection caches behind this are GC-aware: when the sender's original gets garbage-collected, the peer is notified and drops its cached revived value. `identity()` is idempotent, and primitives pass through unchanged; see the [identity() reference](/reference/identity/) for the exact signature and the `identity-dispose` wire behavior.

Because later sends of an already-tracked reference ship only an id instead of the full payload, `identity()` also dedupes repeat sends of large objects; see [Performance](/guides/performance/).

## `transfer()`: zero-copy moves

`transfer(value)` opts a `Transferable` (`ArrayBuffer`, `MessagePort`, streams, `ImageBitmap`, `OffscreenCanvas`, …) into **move semantics**: ownership transfers to the peer instead of copying, and the value is detached locally.

```ts twoslash
import { expose } from 'osra'
declare const worker: Worker
const remote = await expose<{ render: (pixels: ArrayBuffer) => Promise<void> }>(
  {},
  { transport: worker },
)
// ---cut---
import { transfer } from 'osra'

const pixels = new ArrayBuffer(16_000_000)
await remote.render(transfer(pixels)) // moved - pixels is detached locally
```

On JSON transports there is nothing to transfer, so `transfer()` silently degrades to a copy.

Some types are **always moved**, with or without `transfer()`, because structured clone cannot copy them: `MessagePort`, `TransformStream`, `OffscreenCanvas`, `MediaSourceHandle`, `MediaStreamTrack`, `MIDIAccess`, `RTCDataChannel`, and WebTransport streams. A bare send still detaches them locally; `transfer()` adds nothing there. It's the clonable Transferables (`ArrayBuffer`, typed-array views, `ImageBitmap`, `VideoFrame`, `AudioData`) where `transfer()` makes the difference between a copy and a move.

:::note
`ReadableStream` and `WritableStream` are never moved at all: their revivable modules proxy them chunk-by-chunk over the connection (sending locks the source rather than detaching it), and `transfer()` is a no-op on them; see [Performance](/guides/performance/) for the implications on large binary data.
:::

Like `identity()`, `transfer()` is idempotent, and non-transferable inputs pass through; see the [transfer() reference](/reference/transfer/) for the exact signature.

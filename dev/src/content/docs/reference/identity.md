---
title: "identity()"
description: "Reference-preserving sends: the same wrapped value revives as the same object on the peer, and a round trip resolves back to the original reference."
---

`identity(value)` opts a value into reference identity across the connection. By default every send produces a fresh copy; wrapping with `identity()` makes the same object revive as the **same** reference on every send, and a round trip back to the sender resolves to the **original** object.

## Signature

```ts
const identity: <T>(value: T) => T
```

`identity()` is idempotent, and primitives pass through unchanged.

## Semantics

Without `identity()`, every send produces an independent copy, including the return trip: a revived value passed back *bare* arrives as a fresh copy, so the returning side must re-wrap it.

Wrapping changes both directions:

- **Same reference on every send**: sending the same wrapped value twice revives as the same object on the peer.
- **Round trip to the original**: when the peer wraps the revived object in `identity()` and sends it back, you receive your original reference (`===`).

`identity()` also dedupes repeat sends on the wire: the first send ships the payload plus an id, later sends of the same reference ship only the id, and the peer reuses its cached revived value; see [performance](/guides/performance/).

## Example

Repeat sends revive as one object:

```ts twoslash
import type { Remote } from 'osra'
type Api = { register: (config: { mode: string }) => Promise<void> }
declare const remote: Remote<Api>
// ---cut---
import { identity } from 'osra'

const config = { mode: 'fast' }
await remote.register(identity(config))
await remote.register(identity(config)) // peer sees the same object twice
```

For a round-trip walkthrough (handing a reference to the peer and receiving the original back), see [identity and transfer](/guides/identity-and-transfer/).

## Garbage collection

Per-connection identity caches are GC-aware: when the sender of an `identity()`-tracked value garbage-collects the original, the peer is notified via an [`identity-dispose`](/reference/wire-protocol/) envelope and evicts its cached revival. Receivers never send `identity-dispose`; their cache holds strong references.

## See also

- [Identity and transfer](/guides/identity-and-transfer/): when to reach for `identity()` versus [`transfer()`](/reference/transfer/)
- [Limitations](/reference/limitations/): shared references duplicate unless wrapped with `identity()`

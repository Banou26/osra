---
title: Multi-peer connections
description: What happens when several peers share one transport, and the per-port expose() pattern for SharedWorkers.
---

A single `expose()` call can be reached by more than one peer when its transport is truly shared: several osra instances announcing on one channel, or a broadcast-style custom transport (the `BroadcastChannel` API is not a recognized platform transport; give it a small `{ emit, receive }` wrapper, see [custom transports](/guides/custom-transports/)). osra connects them all, but the returned promise only ever carries one value. A SharedWorker is different: each page arrives on its own port, so the worker exposes once per port (below).

## First peer wins

The promise returned by `expose()` resolves with the **first** peer's value. Later peers still connect, can call your exposed value, and keep their own connection state, but there is no public accessor for their values.

:::caution
First-wins means the resolved value comes from whichever peer completes the handshake first, including one you did not intend. On a channel where code you do not control can post, pin `origin` on window transports and avoid exposing privileged functions; `key` is namespacing, not access control. See [security](/guides/security/).
:::

## One `expose()` per port

When you need a value *per peer* (the SharedWorker case), expose once per port instead:

```ts twoslash
declare global {
  var onconnect: ((event: MessageEvent) => void) | null
}
// ---cut---
// shared-worker.ts
import { expose } from 'osra'

export const api = { add: async (a: number, b: number) => a + b }

globalThis.onconnect = (event: MessageEvent) => {
  for (const port of event.ports) expose(api, { transport: port })
}
```

```ts twoslash
// @noEmit: true
// @allowImportingTsExtensions: true
// @filename: shared-worker.ts
export const api = { add: async (a: number, b: number) => a + b }
// @filename: main.ts
import { expose } from 'osra'
// ---cut---
// page
import type { api } from './shared-worker.ts'

const worker = new SharedWorker('./shared-worker.ts', { type: 'module' })
const remote = await expose<typeof api>({}, { transport: worker })
```

The page passes the `SharedWorker` object itself; osra sends and listens on its `.port` (and starts it) internally. The worker side gets one `expose()` (and one first-wins promise) per connecting page, so each connection is isolated and each page's value is addressable.

## Bridging peers

To connect two peers that share no direct channel (two workers, or an iframe and a worker), a context that owns both transports can forward envelopes between them with [relay()](/reference/relay/).

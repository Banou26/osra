---
title: Getting started
description: Install osra and connect a page to a Web Worker with a single symmetric, fully typed expose() call.
---

osra is a zero-runtime-dependency TypeScript RPC library that connects two JavaScript contexts over any message channel. This page installs the package and wires a page to a Web Worker; the same `expose()` call works over every other [transport](/guides/transports/).

## Install

```sh
npm install osra
```

One ESM module, zero runtime dependencies. The published declarations require TypeScript >= 5.9 with `strict` mode.

## Quick start

Expose an API inside the worker:

```ts twoslash
// worker.ts
import { expose } from 'osra'

const api = {
  add: async (a: number, b: number) => a + b,
  makeCounter: async () => {
    let count = 0
    return async () => ++count
  },
  streamData: async function* () {
    for (let i = 0; i < 3; i++) yield i
  },
}

export type Api = typeof api

expose(api, { transport: globalThis })
```

Consume it from the page:

```ts twoslash
// @filename: worker.ts
import { expose } from 'osra'
const api = {
  add: async (a: number, b: number) => a + b,
  makeCounter: async () => {
    let count = 0
    return async () => ++count
  },
  streamData: async function* () {
    for (let i = 0; i < 3; i++) yield i
  },
}
export type Api = typeof api
expose(api, { transport: globalThis })
// @filename: main.ts
// ---cut---
// main.ts
import type { Api } from './worker'

import { expose } from 'osra'

const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })

const remote = await expose<Api>({}, { transport: worker })

await remote.add(40, 2) // 42

const counter = await remote.makeCounter()
await counter() // 1
await counter() // 2

for await (const n of await remote.streamData()) {
  console.log(n) // 0, 1, 2
}
```

Both sides call `expose()`; the returned promise resolves with the remote side's value once the handshake completes. A side that only serves (like the worker above) can ignore the returned promise, and a side that only consumes passes `{}`. Functions returned across the boundary stay callable (`makeCounter` hands back a live counter), and async generators stream with `for await`.

:::note
Inside the worker, the transport is `globalThis` (the `DedicatedWorkerGlobalScope`). The `Transport` union includes a structural `WorkerSelf` member that covers worker globals under both `lib.webworker` and `lib.dom`, so `globalThis` is accepted directly; no cast is needed.
:::

## Options

| Option | Default | Description |
|---|---|---|
| `transport` | required | The channel to communicate over (see [Transports](/guides/transports/)) |
| `key` | `'__OSRA_DEFAULT_KEY__'` | Namespacing tag that lets multiple independent osra connections share one channel; any peer on the channel using the same key is accepted |
| `origin` | `'*'` | On window transports: sets the outbound `postMessage` target origin **and** filters inbound messages by `event.origin`. The initial announce beacon alone goes out with `'*'` (see [Transports](/guides/transports/)) |
| `name` / `remoteName` | - | Label your endpoint / only accept envelopes from a matching peer name |
| `unregisterSignal` | - | `AbortSignal` that tears the connection down (see [Lifecycle](/guides/lifecycle/)) |
| `uuid` / `remoteUuid` | random / - | Pin instance uuids. Setting `remoteUuid` makes that side skip announcing and send its init exactly once, so preset it on both sides (`{ uuid: A, remoteUuid: B }` / `{ uuid: B, remoteUuid: A }`); a one-sided preset leaves the other side waiting forever, and preset mode has none of the announce loop's retry tolerance for late-attaching peers |
| `revivableModules` | - | `defaults => modules` function to add, drop, reorder, or override revivable modules (see [Custom revivables](/guides/custom-revivables/)) |

If multiple peers connect over the same transport, the returned promise resolves with the **first** peer's value; later peers still connect and can call your exposed value. See [multi-peer](/guides/multi-peer/).

## Where next

See [transports](/guides/transports/) for every channel osra runs over: windows and iframes, SharedWorkers, WebSockets, service workers, web extensions, and custom `{ emit, receive }` pairs. [Supported types](/guides/supported-types/) lists everything that crosses the boundary, on both structured-clone and JSON transports. For the full `expose()` signature, handshake sequence, and error behavior, read the [expose() reference](/reference/expose/).

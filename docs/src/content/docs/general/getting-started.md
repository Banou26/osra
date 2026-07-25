---
title: Getting started
description: Install osra and connect a page to a worker, with one expose() call on each side.
---

osra lets two JavaScript contexts use each other's values directly. Functions stay callable, promises resolve, generators stream, errors throw where you called them.

Both sides call `expose()`. Each one gets back what the other exposed.

## Install

```sh
npm install osra
```

One ESM module, no runtime dependencies, 13kb gzipped. The published types need TypeScript 5.9+ with `strict` on.

## A worker, in two files

```ts twoslash title="worker.ts"
import { expose } from 'osra'

const payload = {
  hash: crypto.getRandomValues(new Uint8Array(10)),
  add: (a: number, b: number) => a + b,
  makeCounter: () => {
    let count = 0
    return () => ++count
  },
  streamData: async function* () { yield* [0, 1, 2] }
}
export type Payload = typeof payload

expose(payload, { transport: globalThis })
```

```ts twoslash title="main.ts"
// @filename: worker.ts
import { expose } from 'osra'
const payload = {
  hash: crypto.getRandomValues(new Uint8Array(10)),
  add: (a: number, b: number) => a + b,
  makeCounter: () => {
    let count = 0
    return () => ++count
  },
  streamData: async function* () { yield* [0, 1, 2] }
}
export type Payload = typeof payload
expose(payload, { transport: globalThis })
// @filename: main.ts
// ---cut---
import type { Payload } from './worker'
import { expose } from 'osra'

const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })

export const {
  hash, // Uint8Array
  add, // (a: number, b: number) => Promise<number>
  makeCounter, // () => Promise<() => Promise<number>>
  streamData, // () => Promise<AsyncIterableIterator<number>>
} = await expose<Payload>({}, { transport: worker })

hash.byteLength // 10

await add(40, 2) // 42

const counter = await makeCounter()
await counter() // 1
await counter() // 2

for await (const n of await streamData()) {
  console.log(n) // 0, 1, 2
}
```

## What expose() gives you

`expose(value, options)` sends your value to the peer and returns a promise for the peer's value. It resolves once both sides have found each other.

The worker above never uses its returned promise, which is fine. A side that only serves can ignore it, and a side that only consumes passes `{}` as its own value.

Data gets copied, everything else gets proxied. `hash` arrives as a real `Uint8Array` you can read synchronously. `add` arrives as a function returning a promise, because the call has to cross the boundary. Same for the counter that `makeCounter` hands back: it stays a live function in the worker, so calling it from the page runs it in the worker.

The type parameter (`expose<Payload>`) is what the peer exposed. osra maps it through [`Remote<T>`](/reference/typescript/) so your side sees the types that actually arrive.

## The two transport modes

`transport` is the channel the two sides talk over. Every transport is one of two modes, and the mode decides which types can cross:

- **Structured-clone**, for [`Worker`](https://developer.mozilla.org/en-US/docs/Web/API/Worker), [`Window`](https://developer.mozilla.org/en-US/docs/Web/API/Window), [`MessagePort`](https://developer.mozilla.org/en-US/docs/Web/API/MessagePort) and friends. The fast one, and the only one that can move values instead of copying them.
- **JSON**, for [`WebSocket`](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket) and web extension messaging. Slower and a bit more limited, but it reaches contexts the other mode cannot.

Most types work on both. See [transports](/guides/transports/) for the list of channels, and [supported types](/guides/supported-types/) for what crosses on each mode.

## Where to go next

- [Transports](/guides/transports/) covers workers, iframes, WebSockets, service workers and extensions.
- [Supported types](/guides/supported-types/) is the table of everything you can send.
- [Live values](/guides/live-values/) explains how functions, streams and generators behave once proxied.
- [expose()](/reference/expose/) is the full option list.

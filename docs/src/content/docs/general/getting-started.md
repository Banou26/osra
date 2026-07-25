---
title: Getting started
description: Install osra and connect a page to a worker, with one expose() call on each side.
---

osra is an RPC library for JavaScript contexts. It carries most of the common JS and platform value types across the boundary, and keeps functions, promises, async generators and streams live instead of flattening them to data.

Both sides call `expose()`. Each resolves with the other's value, typed.

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

`expose(value, options)` boxes your value, sends it, and returns a promise for the peer's. It resolves once the handshake completes.

The worker above ignores its returned promise. A side that only serves can, and a side that only consumes passes `{}` as its own value.

Data is copied, live values are proxied. `hash` arrives as a real `Uint8Array`, readable synchronously. `add` arrives as `(a, b) => Promise<number>`, since the call is a round trip. The counter `makeCounter` returns stays a closure in the worker, so calling it from the page mutates the worker's `count`.

`expose<Payload>` declares what the peer exposed. osra maps it through [`Remote<T>`](/reference/typescript/), which is the same type after proxying.

## The two transport modes

`transport` is the channel the two sides talk over. Its mode determines which types can cross:

- **Structured**, for [`Worker`](https://developer.mozilla.org/en-US/docs/Web/API/Worker), [`Window`](https://developer.mozilla.org/en-US/docs/Web/API/Window), [`MessagePort`](https://developer.mozilla.org/en-US/docs/Web/API/MessagePort) and friends. Rides [structured clone](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Structured_clone_algorithm), so it carries the full clonable set and is the only mode that can transfer ownership instead of copying.
- **JSON**, for [`WebSocket`](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket) and web extension messaging. Binary goes base64 and the structured-only types are unavailable, in exchange for reaching contexts structured clone cannot.

Most types work on both. See [transports](/guides/transports/) for the list of channels, and [supported types](/guides/supported-types/) for what crosses on each mode.

## Where to go next

- [Transports](/guides/transports/) covers workers, iframes, WebSockets, service workers and extensions.
- [Supported types](/guides/supported-types/) is the table of everything you can send.
- [Live values](/guides/live-values/) explains how functions, streams and generators behave once proxied.
- [expose()](/reference/expose/) is the full option list.

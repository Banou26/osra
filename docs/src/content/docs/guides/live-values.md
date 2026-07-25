---
title: Live values
description: How functions, promises, generators, streams and abort signals behave once they cross a connection.
---

Data is copied. Functions, promises, generators, streams, abort signals and event targets are not: the original stays in its context, and the peer gets a proxy whose traffic routes back to it over a dedicated channel.

Which means their semantics are not quite the local ones. This page is the differences.

## Functions

A function arrives as `(...args) => Promise<result>`. Everything else follows from that.

Arguments and return values go through the same treatment as anything else, so you can pass callbacks, get functions back, and nest them as deep as you like.

```ts twoslash title="worker.ts"
import { expose } from 'osra'

const payload = {
  each: (items: number[], onItem: (item: number) => void) => {
    for (const item of items) onItem(item)
  }
}
export type Payload = typeof payload

expose(payload, { transport: globalThis })
```

```ts twoslash title="main.ts"
// @filename: worker.ts
import { expose } from 'osra'
const payload = {
  each: (items: number[], onItem: (item: number) => void) => {
    for (const item of items) onItem(item)
  }
}
export type Payload = typeof payload
expose(payload, { transport: globalThis })
// @filename: main.ts
declare const worker: Worker
// ---cut---
import type { Payload } from './worker'
import { expose } from 'osra'

const { each } = await expose<Payload>({}, { transport: worker })

await each([1, 2, 3], item => console.log(item)) // 1, 2, 3
```

A throw on the far side rejects your promise, with the error revived as its own class where possible. See [errors and lifecycle](/guides/lifecycle/).

Every call is one round trip. Cheap individually, linear in a loop. Expose a function that takes the batch rather than calling one a thousand times.

## Promises

A promise settles when the original settles, rejection included.

`Remote<T>` already wraps every function result in a promise, so a function returning `Promise<number>` is `Promise<number>` on your side, not `Promise<Promise<number>>`.

## Async generators

A generator arrives as an `AsyncIterableIterator`. `next`, `return` and `throw` are all proxied, so `for await` works, and breaking out early runs the source's `finally` block.

```ts
for await (const item of await streamData()) {
  if (item > 10) break // the generator's finally runs on the other side
}
```

Two things to watch:

**Iteration starts when you send it.** osra calls `[Symbol.asyncIterator]()` at send time. A generator object returns itself from that method, so sending the same generator to two places gives them one shared cursor that both advance. Expose a function that makes a fresh generator per call instead, like `streamData()` above, or send an async iterable whose `[Symbol.asyncIterator]` builds a new iterator each time.

**One item is one round trip.** No batching, no readahead. Use a `ReadableStream` when throughput matters, its credit window pipelines.

## ReadableStream

Streams are proxied chunk by chunk, never moved, and they pipeline. The reader grants the producer a credit window, the producer pushes up to it without waiting, and a slow reader naturally slows the producer down.

The window starts at 8 chunks and adapts between 2 and 64 against a 4 MiB budget of data in flight, so small chunks go deep and large ones stay shallow. Chunks whose size cannot be measured (plain objects, `Map`s) hold at 8.

Two consequences:

- The producer starts reading on revival, up to that first window, before your first `read()`.
- `cancel(reason)` reaches the source stream with the reason intact.

**A stream locks when you send it.** osra calls `getReader()` at send time, even if the peer never reads. Sending the same `ReadableStream` twice fails, and so does sending a `Request` or `Response` whose body already went out.

## WritableStream

Writes are proxied the other way, one operation at a time. Each `write()` waits for the far sink to acknowledge it, so the remote backpressure is your backpressure, at the cost of one round trip per write.

An error in the sink rejects your writer with a plain `Error` carrying the original message. The class and any extra properties do not cross.

## AbortSignal

A signal arrives as the signal of a fresh controller on the other side. Abort it at the source and the reason propagates.

A signal already aborted at send time revives aborted, synchronously. Otherwise abort arrives asynchronously, so the revived signal reads `aborted === false` until the message lands.

Connection teardown does not abort revived signals, so a remote signal is not a liveness check. Use `unregisterSignal` or the rejection of your pending calls. See [errors and lifecycle](/guides/lifecycle/).

## Making it fast

- **Batch calls.** One call returning 1000 rows is one round trip, 1000 calls are 1000.
- **Streams over generators** for high volume, so the credit window can pipeline.
- **Structured transport over JSON** where you have the choice, JSON base64s binary data.
- **[`transfer()`](/guides/identity-and-transfer/) large buffers** to move rather than copy.
- **Send data as data.** A `Map` of 10000 entries is one message.

---
title: Connections
description: Read every peer, learn who each one is, and give each one its own value.
---

`expose()` gives you back a connection. Awaiting it gives the first one, iterating gives every one as it arrives, and both hand back the same shape.

```ts twoslash
import { expose } from 'osra'
declare const worker: Worker
type Api = { ping: () => string }
// ---cut---
const remote = await expose<Api>({}, { transport: worker })

for await (const remote of expose<Api>({}, { transport: worker })) {
  remote.ping()
}
```

By default that shape is the peer's value, which is what `expose()` has always resolved to. The `connection` option changes it.

## Choosing what a connection is

`connection` receives `{ value, context }` and returns whatever a connection should mean in your code.

```ts twoslash
import { expose } from 'osra'
declare const worker: Worker
// ---cut---
const { value, context } = await expose({}, {
  transport: worker,
  connection: ({ value, context }) => ({ value, context })
})
```

It is a plain function, so it can return anything. Take one field and nothing else:

```ts twoslash
import { expose } from 'osra'
declare const worker: Worker
// ---cut---
for await (const origin of expose({}, {
  transport: worker,
  connection: ({ context }) => context.origin
})) {
  origin // string | undefined
}
```

It runs once per connection, on your side, after the handshake. It cannot change what you send, and nothing it returns crosses the wire.

## What is in the context

Only what the transport actually observed, plus an `abort` for that one peer. Fields come off the inbound message and appear only when the browser set them:

| Transport | Context |
|---|---|
| Window, iframe | `abort`, `origin`, `source` |
| WebExtension | `abort`, `port`, `sender` |
| WebSocket | `abort`, `origin` |
| MessagePort, Worker, SharedWorker | `abort` |

Two of those rows deserve a warning.

**A port or a worker observes nothing.** Their messages carry `origin: ''` and `source: null`, so neither survives. A server handing out ports therefore cannot learn who a peer is from the connection, and does not need to: it created that port in response to something that did know, so the identity is already in scope where you call `expose()`.

**A WebSocket's `origin` is the socket URL**, not the peer. Every peer on the same relay reports the same one. It is useless for telling them apart, so identify relay peers with `key`, `name`, or something in your own payload.

Nothing in the context is sent anywhere, and nothing the peer sends can reach it. It is built from what the browser told your side about the delivery, which the peer cannot forge.

## A different value per peer

Wrap your value in `context()` and it is built once per connection, from that connection's context, instead of one object shared by everyone.

```ts twoslash
import { expose, context } from 'osra'
declare const worker: Worker
declare const readFor: (origin: string | undefined) => (path: string) => string
// ---cut---
expose(context(({ origin }) => ({ read: readFor(origin) })), { transport: worker })
```

It runs **before** your value is boxed and sent, which is what makes it useful: a server embedded by several realms can answer each one differently rather than exposing one object to all of them.

It is a wrapper rather than "pass a function" because osra exposes functions as endpoints, so a bare function is a value you are exposing, not a factory:

```ts twoslash
import { expose } from 'osra'
declare const worker: Worker
// ---cut---
expose(async (n: number) => n * 2, { transport: worker }) // an endpoint, called by the peer
```

The factory and `connection` receive the same context object, so anything the read side needs it can derive itself. Nothing has to be declared up front.

## Dropping one peer

`context.abort()` closes that connection and leaves the others alone. `unregisterSignal` is still the way to tear down your whole side, see [lifecycle](/guides/lifecycle/).

```ts twoslash
import { expose } from 'osra'
declare const worker: Worker
declare const allowed: (origin: string | undefined) => boolean
// ---cut---
for await (const peer of expose({}, {
  transport: worker,
  connection: ({ value, context }) => ({ value, context })
})) {
  if (!allowed(peer.context.origin)) peer.context.abort?.()
}
```

Called from inside a `context()` factory it refuses the peer outright, before your value is sent, and the peer's own `expose()` rejects:

```ts twoslash
import { expose, context } from 'osra'
declare const worker: Worker
declare const allowed: (origin: string | undefined) => boolean
declare const resolvers: { read: (path: string) => string }
// ---cut---
expose(
  context(ctx => {
    if (!allowed(ctx.origin)) ctx.abort?.()
    return resolvers
  }),
  { transport: worker }
)
```

## Every loop sees every peer

Several loops over one `expose()` each get every connection. They are independent readers, not a shared queue, so one loop cannot consume a peer another was waiting for.

Peers that connect before anything iterates are buffered, up to 32, and replayed to the first loop that starts. A side that only ever awaits does not accumulate them.

## Typing it

With no `connection`, `expose<Api>()` types the result as `Remote<Api>` exactly as before. With one, the result type is inferred from what the function returns.

Those two cannot be combined, because TypeScript has no partial type-argument inference: passing `<Api>` makes every later type parameter fall back to its default, so the inferred result is lost. Type the peer on the function's parameter instead.

```ts twoslash
import { expose } from 'osra'
import type { Connected, Remote } from 'osra'
declare const worker: Worker
type Api = { ping: () => string }
// ---cut---
const { value, context } = await expose({}, {
  transport: worker,
  connection: ({ value, context }: Connected<Remote<Api>>) => ({ value, context })
})

await value.ping()
```

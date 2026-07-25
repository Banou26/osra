---
title: Errors and lifecycle
description: How errors travel, when expose() rejects, and what happens when a connection goes away.
---

## Errors travel

A throw on the far side rejects your promise with the error itself, not a description of it.

```ts twoslash
declare const parse: (input: string) => Promise<unknown>
// ---cut---
try {
  await parse('nope')
} catch (error) {
  if (error instanceof TypeError) {
    error.message // the original message
    error.stack // the far side's stack
  }
}
```

Built-in error classes keep their class. Your own subclasses arrive as a plain `Error` with the same `name`, so compare on `error.name` rather than `instanceof`. Details in [supported types](/guides/supported-types/#errors).

## Connecting

`expose()` resolves once the two sides have found each other. Until then it keeps announcing itself, backing off from 50ms up to a second, which is what lets you expose to an iframe that has not loaded yet or a worker that starts late.

It rejects when the connection can never happen:

- the transport cannot both send and receive
- your own value cannot be sent, a circular structure for example
- the peer's first message is malformed
- the peer closes before the handshake finishes
- `unregisterSignal` is aborted

If there is genuinely nobody on the other end, it stays pending. That is deliberate, since a peer that shows up ten seconds later still connects. Race it against a timeout if you need one.

## Closing

Pass an `AbortSignal` as `unregisterSignal` and abort it to tear your side down.

```ts twoslash
import { expose } from 'osra'
declare const worker: Worker
type Api = { slowCall: () => Promise<string> }
// ---cut---
const controller = new AbortController()

const remote = await expose<Api>({}, {
  transport: worker,
  unregisterSignal: controller.signal
})

const pending = remote.slowCall()

controller.abort(new Error('shutting down'))

// pending rejects with Error('osra: connection closed')
```

Aborting does four things: it stops listening on the transport, tells every connected peer the connection is over, rejects your own pending calls, and rejects the `expose()` promise if it had not resolved yet.

The peer that receives that notice does the same on its side, so pending calls reject on **both** ends rather than hanging. Streams get cancelled or aborted with the same error, and writers reject.

A signal that is already aborted when you call `expose()` short-circuits: nothing is registered and the promise rejects immediately with the abort reason.

Aborting does not poison the transport. Calling `expose()` on it again starts a fresh handshake.

## What survives a close

On a structured transport, promises and streams that ride a real transferred `MessagePort` are independent of the osra connection and keep working after it closes. Anything routed through the connection itself, which is everything on a JSON transport, dies with it.

So a remote `AbortSignal` is not a liveness check, it will not fire on teardown. Use your own `unregisterSignal`, or the rejection of a pending call.

## Errors you might see

| Message | What happened |
|---|---|
| `osra: connection closed` | Your side aborted, or the peer did. Pending calls, streams and writers all get this. |
| `osra: peer closed the connection` | The peer went away before the handshake finished. |
| `osra: transport must be able to both emit and receive…` | You passed half a transport. Pair it with `{ emit, receive }`. |
| `osra: cannot serialize a circular structure` | Break the cycle, or send the shared part once with [`identity()`](/guides/identity-and-transfer/). |
| `osra: stream exceeded its credit window` | A peer pushed past its grant. Usually a hand-rolled implementation of the protocol. |
| `osra: Blob is only supported on structured-clone transports` | Send an `ArrayBuffer` instead. |

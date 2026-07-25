---
title: expose()
description: The full signature, every option, and what the returned promise does.
---

```ts
expose<Peer>(value, options): Promise<Remote<Peer>>
```

Sends `value` to the peer and returns a promise for the peer's value. Both sides call it. There is no client and no server, only two ends that each expose something.

`Peer` is the type the peer exposed. osra maps it through [`Remote<T>`](/reference/typescript/) so what you get back matches what actually arrives. Leave it out on a side that only serves.

`value` is checked against [`Capable`](/reference/typescript/), which is every type osra can send over the transport you passed. A value it cannot send is a compile error at the call site, with the path to the offending field.

## Options

| Option | Default | |
|---|---|---|
| `transport` | required | The channel to talk over. See [transports](/guides/transports/). |
| `key` | `'__OSRA_DEFAULT_KEY__'` | Which logical channel this connection is on. Both sides need the same one. |
| `origin` | `'*'` | On window transports, the origin allowed in both directions. Sets `targetOrigin` going out, filters `event.origin` coming in. |
| `name` | | A label for your side. |
| `remoteName` | | Only accept a peer with this `name`. |
| `unregisterSignal` | | Abort it to tear this side down. See [lifecycle](/guides/lifecycle/). |
| `uuid` | random | Pin this instance's id instead of generating one. |
| `remoteUuid` | | Pin the peer's id and skip the handshake. Set it on both sides or neither. See [multiple peers](/guides/multiple-peers/#uuid-and-remoteuuid). |
| `revivableModules` | defaults | `defaults => modules`, to add or replace types. See [custom revivables](/guides/custom-revivables/). |

## The returned promise

It resolves once a peer has connected, with that peer's value.

If several peers answer, it resolves with the **first** one. The others still connect and can call into your value, you just have no handle on them. See [multiple peers](/guides/multiple-peers/).

It rejects when:

- the transport cannot both send and receive
- your value cannot be boxed, a circular structure for example
- the peer's first message is malformed
- the peer closes before the handshake completes
- `unregisterSignal` aborts, with the abort reason

It stays pending while nobody is there. osra keeps announcing itself, so a peer that appears later still connects.

A side that only serves can ignore the promise entirely. It will not produce an unhandled rejection.

```ts twoslash
import { expose } from 'osra'
const api = { ping: () => 'pong' }
// ---cut---
expose(api, { transport: globalThis }) // fine, nothing to await
```

## Both directions

Both sides can pass a value and both can call. The worker below serves and consumes at once:

```ts twoslash title="worker.ts"
import { expose } from 'osra'

type PageApi = { log: (line: string) => void }

const workerApi = { work: () => 42 }
export type WorkerApi = typeof workerApi

const { log } = await expose<PageApi>(workerApi, { transport: globalThis })

await log('worker ready')
```

## Custom module lists

When you pass `revivableModules`, pass the module list as the second type argument too, so the value check knows about your types:

```ts
expose<PeerApi, ReturnType<typeof myModules>>(value, {
  transport,
  revivableModules: myModules
})
```

---
title: "expose()"
description: Full reference for expose(), the single entry point that exposes a value to a peer and resolves with the peer's exposed value.
---

`expose()` is osra's single entry point. It exposes `value` to the peer on the other side of a transport and resolves with the peer's exposed value.

## Signature

```ts
const expose: <T = unknown>(
  value: Capable,
  options: StartConnectionsOptions & { transport: Transport },
) => Promise<Remote<T>>
```

The value you pass is validated at compile time against `Capable`, the union of everything serializable for the inferred transport — see [Remote&lt;T&gt; and TypeScript](/reference/typescript/).

## Both sides call expose()

There is no separate client/server entry point. A side that only consumes passes `{}`:

```ts twoslash
// worker.ts
import { expose } from 'osra'

expose({ ping: async (n: number) => n + 1 }, { transport: globalThis })
```

```ts twoslash
// main.ts
import { expose } from 'osra'

type Api = { ping: (n: number) => Promise<number> }

const worker = new Worker('./worker.js', { type: 'module' })
const api = await expose<Api>({}, { transport: worker })
await api.ping(41) // 42
```

A side that only serves can ignore the returned promise.

## Handshake

The handshake is announce → announce-reply → init: each side broadcasts `announce`, peers reply with an addressed `announce`, then each side sends `init` carrying its boxed value. The returned promise resolves once the peer's `init` arrives and revives. The full dance, including its loss tolerance, is described in [handshake internals](/internals/handshake/).

With multiple peers on one transport, the promise resolves with the **first** peer's value (first wins); later peers still connect and can call into your value, but there is no public accessor for their values. See [multi-peer](/guides/multi-peer/) for patterns that give you a value per peer.

## Options (`StartConnectionsOptions`)

| Option | Type | Default | Semantics |
|---|---|---|---|
| `transport` | `Transport` | required | The channel to the peer. See [transports](/guides/transports/). |
| `name` | `string` | - | Stamped on every outgoing envelope as `name`. |
| `remoteName` | `string` | - | Inbound filter: envelopes whose `name` differs are dropped. |
| `key` | `string` | `OSRA_DEFAULT_KEY` (`'__OSRA_DEFAULT_KEY__'`) | **Namespacing, not authentication.** Envelopes carry it under `__OSRA_KEY__`; inbound messages with a different key are ignored, so multiple independent osra connections can share one channel. |
| `origin` | `string` | `'*'` | Outbound: the `targetOrigin` for `window.postMessage` (windows only). Inbound: on **window** receive transports, events whose non-empty `event.origin` differs are dropped; non-window transports are not origin-filtered. The one exception (the announce beacon broadcasts with `'*'`) and the full rationale live in [security](/guides/security/). |
| `unregisterSignal` | `AbortSignal` | - | Teardown handle, see below. |
| `revivableModules` | `(defaults: DefaultRevivableModules) => TModules` | defaults as-is | Configure the revivable module list. See [custom revivables](/guides/custom-revivables/). |
| `uuid` | `Uuid` | `crypto.randomUUID()` | This side's identity, stamped on every envelope. Own messages looped back on the channel are ignored by uuid match. |
| `remoteUuid` | `Uuid` | - | Preset the peer's uuid to skip the announce handshake, see below. |

## `unregisterSignal` teardown

Aborting the signal tears the connection down on both sides: the message listener stops, every tracked peer receives a protocol `close`, per-connection state is disposed, the pending `expose()` promise rejects with the abort reason, and in-flight RPC calls reject with `Error('osra: connection closed')` — on the peer too. The full teardown behavior (the already-aborted case, stream cancellation, what survives connection death) is documented in [lifecycle](/guides/lifecycle/).

## Preset uuids (`uuid` + `remoteUuid`)

When `remoteUuid` is set, that side skips `announce` entirely and immediately sends `init` addressed at the preset uuid. **Both sides must preset**: each side's `uuid` fixed and `remoteUuid` pointing at the other:

```ts twoslash
import { expose } from 'osra'
const value = { hello: async () => 'world' }
const { port1, port2 } = new MessageChannel()
const uuidA = crypto.randomUUID()
const uuidB = crypto.randomUUID()
// ---cut---
expose(value, { transport: port1, uuid: uuidA, remoteUuid: uuidB })
const remote = await expose({}, { transport: port2, uuid: uuidB, remoteUuid: uuidA })
```

No `announce` envelope is ever emitted; `init` flows directly.

:::caution
A one-sided preset is not supported, but the failure is asymmetric: the non-presetting peer drops the presetting side's early `init` (untracked uuid) and its `expose()` hangs forever, while the presetting side still answers the peer's broadcast `announce`, receives the peer's `init`, and resolves.
:::

## Errors

- `expose()` rejects immediately if the (normalized) transport cannot both emit and receive, e.g. a bare `ServiceWorker` or a custom `{ emit }` without `receive`.
- Boxing a value that cannot be serialized (e.g. a circular structure) rejects the returned promise with a `TypeError`; so does reviving a malformed/cyclic `init` payload from a peer.
- A peer's protocol `close` arriving before `init` rejects the pending promise with `Error('osra: peer closed the connection')`.

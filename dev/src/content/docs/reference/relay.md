---
title: "relay()"
description: "Forward osra envelopes between two transports so endpoints with no direct channel can handshake through a middleman."
---

`relay(transportA, transportB)` is a pure wire between two [transports](/guides/transports/): every osra envelope received on one side is forwarded verbatim (with its transferables re-collected) to the other, in both directions where the transports allow it. The relay never establishes a connection of its own; the endpoints handshake with each other through it.

## Signature

```ts
const relay: (transportA: Transport, transportB: Transport, options?: RelayOptions) => void
```

Typical use: bridging two workers, or an iframe to a worker, through a page that owns both transports.

```ts twoslash
declare const workerA: Worker
declare const workerB: Worker
declare const controller: AbortController
// ---cut---
import { relay } from 'osra'

relay(workerA, workerB, { unregisterSignal: controller.signal })
```

The relay is built on exactly the [low-level messaging](/reference/low-level/) primitives: it filters and forwards raw envelopes, nothing more. The endpoints on either side run their normal [handshake](/internals/handshake/) through it.

## `RelayOptions`

| Option | Type | Default | Semantics |
|---|---|---|---|
| `key` | `string` | `OSRA_DEFAULT_KEY` | Only envelopes with this key are forwarded. |
| `origin` | `string` | `'*'` | Default for both directions. |
| `originA` / `originB` | `string` | `origin` | Per-side origin (inbound filter from that side + outbound `targetOrigin` toward it). |
| `nameA` / `nameB` | `string` | - | Only forward envelopes from that side whose `name` matches. |
| `unregisterSignal` | `AbortSignal` | - | Stops forwarding in both directions. |

## One-way degradation

A direction is only wired when the source can receive and the destination can emit; emit-only/receive-only pairs degrade to one-way forwarding.

## Capability classes must match

:::caution
Endpoints box values for their *own* transport: on a structured-clone transport, `MessagePort`s (and values riding them) are sent as real transferred ports. Relaying such an envelope onto a JSON transport (e.g. `MessagePort → WebSocket`) destroys the embedded ports in serialization. Keep both legs in the same class: both structured-clone or both JSON.
:::

See [JSON vs clone transports](/internals/json-vs-clone/) for what distinguishes the two classes.

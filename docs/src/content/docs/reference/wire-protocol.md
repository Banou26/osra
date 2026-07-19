---
title: "Wire protocol"
description: "The envelope format osra puts on the wire: base fields, message variants, addressing rules, boxes, and exported constants."
---

Every message osra puts on a transport is an **envelope**: a set of base fields merged with exactly one variant. This page documents the format itself; for how the variants are used to establish a connection, see the [handshake](/internals/handshake/).

## Envelope

Base fields carry the sender's identity and the namespacing key:

```ts
{ "__OSRA_KEY__": key, uuid, name? }   // base: sender identity + namespacing
```

## Variants

| Variant | Shape | Meaning |
|---|---|---|
| announce | `{ type: 'announce', remoteUuid? }` | Without `remoteUuid`: broadcast presence. With: addressed reply to a specific peer. |
| close | `{ type: 'close', remoteUuid }` | Sender is tearing down its side of the connection. |
| init | `{ type: 'init', remoteUuid, data }` | The sender's boxed exposed value. |
| message | `{ type: 'message', remoteUuid, portId, seq?, data }` | Payload for a wire-routed message port; see [port messages and ordering](#port-messages-and-ordering). |
| message-port-close | `{ type: 'message-port-close', remoteUuid, portId, seq? }` | A routed port closed. |
| identity-dispose | `{ type: 'identity-dispose', remoteUuid, id }` | The **sender** of an [`identity()`](/reference/identity/)-tracked value garbage-collected the original; the receiver evicts its cached revival. (Receivers never send this; their cache holds strong references.) |

## Addressing

`uuid` is always the **sender**; `remoteUuid` addresses the **recipient**. Peers drop variants addressed to other uuids, and drop `init`/`message` traffic from uuids they haven't completed an announce exchange with.

## Port messages and ordering

Function calls always ride wire-routed port messages: each callable gets a `portId`, and its calls and results travel as `message` variants over the one connection, on every transport. On [JSON transports](/internals/json-vs-clone/) all other live values (promises, streams, abort signals, `MessagePort`s) ride these envelopes too; on structured-clone transports those live values ride real transferred `MessageChannel` ports instead, so only function-call traffic appears as `message` variants there.

Every `message` and `message-port-close` is stamped with a monotonic per-port `seq`, starting at 0. The receiver buffers by `seq` and delivers strictly in send order, which is what keeps function calls, streams, and routed ports correct over transports with no ordering guarantee (WebExtension `runtime.sendMessage`, relays). Closes are stamped too, so a close can never overtake trailing data. The field is optional on the wire only for [compatibility with peers on 0.5.6 or earlier](#compatibility-with-older-versions).

## Boxes

Non-trivial values inside `data` are **boxes**: plain serializable objects tagged with the module type that owns them.

```ts
{ "__OSRA_BOX__": 'revivable', type: '<module type>', ...fields }
```

For example `{ "__OSRA_BOX__": 'revivable', type: 'date', ... }`. Each box is produced and revived by a revivable module; you can add your own. See [custom revivables](/guides/custom-revivables/).

## Exported constants

| Constant | Value |
|---|---|
| `OSRA_KEY` | `'__OSRA_KEY__'` |
| `OSRA_DEFAULT_KEY` | `'__OSRA_DEFAULT_KEY__'` |
| `OSRA_BOX` | `'__OSRA_BOX__'` |

## Compatibility with older versions

- **Port ordering**: peers on 0.5.6 or earlier send port messages without `seq`. Those messages bypass the reorder buffer: they are delivered immediately in arrival order, and dropped if they arrive before the port's handler registers. The strict in-order guarantee holds only between current versions.
- **Streams**: a boxed `ReadableStream` advertises `credit: true` on its box; a box from 0.5.5 or earlier lacks the field, so a current consumer speaks the legacy one-round-trip pull protocol to it, and a current box still answers legacy `{ type: 'pull' }` messages. Both mixed pairings, including cancel, are tested against verbatim 0.5.5 implementations.

## Trust model

`key` is namespacing only; `origin` filters window messages both ways. Beyond that, treat peers as semi-trusted: malformed payloads reject cleanly, but flood-resistance hardening is incomplete. See [security](/guides/security/).

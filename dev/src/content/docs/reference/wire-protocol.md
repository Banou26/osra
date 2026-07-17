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
| message | `{ type: 'message', remoteUuid, portId, data }` | Payload for a routed message port (functions, streams, JSON-mode ports all ride these). |
| message-port-close | `{ type: 'message-port-close', remoteUuid, portId }` | A routed port closed. |
| identity-dispose | `{ type: 'identity-dispose', remoteUuid, id }` | The **sender** of an [`identity()`](/reference/identity/)-tracked value garbage-collected the original; the receiver evicts its cached revival. (Receivers never send this; their cache holds strong references.) |

## Addressing

`uuid` is always the **sender**; `remoteUuid` addresses the **recipient**. Peers drop variants addressed to other uuids, and drop `init`/`message` traffic from uuids they haven't completed an announce exchange with.

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

## Trust model

`key` is namespacing only; `origin` filters window messages both ways. Beyond that, treat peers as semi-trusted: malformed payloads reject cleanly, but DoS-hardening is not complete. See [security](/guides/security/).

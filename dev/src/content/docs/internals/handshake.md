---
title: The handshake
description: How two expose() calls discover each other — announce, reply, echo, init — and why the exchange survives dropped messages.
---

Both sides call `expose()`; there is no client/server distinction (`src/connections/bidirectional.ts`). Before either side can deliver its value, the two instances have to discover each other's uuids — that discovery is the announce handshake.

## The four steps

1. **announce**: each side broadcasts `{ type: 'announce' }` (no `remoteUuid`).
2. **reply**: a side receiving an unaddressed announce replies `{ type: 'announce', remoteUuid: <sender's uuid> }`.
3. **echo + init**: a side receiving an announce addressed to itself from an untracked uuid echoes an announce back (in case the peer missed its initial one), registers the connection, and sends `{ type: 'init', remoteUuid, data: recursiveBox(value) }`. A second addressed announce from an already-tracked uuid is recognized as the normal handshake echo and dropped.
4. **revive**: each side resolves its `expose()` promise by reviving the peer's `init` data.

Envelope shapes are documented in the [wire protocol reference](/reference/wire-protocol/). On window transports, the unsolicited announce beacon is the one envelope posted with `targetOrigin` `'*'` regardless of the configured `origin` — it carries only channel identifiers, no data, and everything after it keeps the strict `targetOrigin`; see [security](/guides/security/) for the full reasoning.

## Why the dance is loss-tolerant

The announce dance is loss-tolerant by design: both sides announce, and every announce a live listener receives produces a response, so if one initial announce is dropped — for example, Firefox discards messages posted to a fresh module worker before its listener attaches — the other side's announce still completes the exchange. `init` is only sent after a bidirectional announce exchange, by which point both listeners provably exist.

## Preset `remoteUuid` mode

If both sides pass fixed ids, the announce phase is skipped entirely and `init` flows immediately:

```ts twoslash
import { expose } from 'osra'

const apiA = { ping: async () => 'pong' }
const apiB = { pong: async () => 'ping' }
const uuidA = crypto.randomUUID()
const uuidB = crypto.randomUUID()
declare const transport: Worker
// ---cut---
expose(apiA, { transport, uuid: uuidA, remoteUuid: uuidB })
expose(apiB, { transport, uuid: uuidB, remoteUuid: uuidA })
```

No `announce` envelope is ever emitted. The `uuid` and `remoteUuid` options are documented in the [expose() reference](/reference/expose/).

:::caution
**No loss recovery.** `init` is sent exactly once, at `expose()` time. If the peer's listener isn't attached yet and the channel doesn't buffer, the init is lost and that side's `expose()` hangs.
:::

Preset **both** sides: a one-sided preset can race — the preset side's init arrives before the announcing side has tracked its uuid and is dropped. And only use this mode over channels that queue (a `MessagePort` before `start()`) or when both ends are known to be listening.

## Handshake errors

Every handshake failure rejects `expose()` rather than hanging — an unusable transport, a circular value throwing during boxing, a malformed `init` from the peer (the revive error surfaces), or a peer `close` arriving before its `init`. The exact errors are listed in the [expose() reference](/reference/expose/#errors).

For teardown after a successful handshake — `unregisterSignal`, protocol `close`, and what survives connection death — see [lifecycle](/guides/lifecycle/).

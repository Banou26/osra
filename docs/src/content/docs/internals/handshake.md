---
title: The handshake
description: How two expose() calls discover each other (announce, reply, echo, init) and why the exchange survives dropped messages.
---

Both sides call `expose()`; there is no client/server distinction (`src/connections/bidirectional.ts`). Before either side can deliver its value, the two instances have to discover each other's uuids; that discovery is the announce handshake.

## The four steps

1. **announce**: each side broadcasts `{ type: 'announce' }` (no `remoteUuid`).
2. **reply**: a side receiving an unaddressed announce replies `{ type: 'announce', remoteUuid: <sender's uuid> }`.
3. **echo + init**: a side receiving an announce addressed to itself from an untracked uuid echoes an announce back, registers the connection, and sends `{ type: 'init', remoteUuid, data: recursiveBox(value) }`. The echo is a required step of every handshake, not just loss recovery: the side that replied in step 2 has not yet built a connection, and only registers it (and sends its own init) when this addressed echo arrives. A second addressed announce from an already-tracked uuid is recognized as the normal handshake echo and dropped.
4. **revive**: each side resolves its `expose()` promise by reviving the peer's `init` data.

Envelope shapes are documented in the [wire protocol reference](/reference/wire-protocol/). On window transports, the unsolicited announce beacon is the one envelope posted with `targetOrigin` `'*'` regardless of the configured `origin`: it carries only channel identifiers, no data, and everything after it keeps the strict `targetOrigin`; see [security](/guides/security/) for the full reasoning.

## Why the dance is loss-tolerant

The announce dance is loss-tolerant by design: both sides announce, and every announce a live listener receives produces a response, so if one initial announce is dropped (for example, Firefox discards messages posted to a fresh module worker before its listener attaches), the other side's announce still completes the exchange. `init` is only sent after a bidirectional announce exchange, by which point both listeners provably exist.

### The announce retry loop

Unless `remoteUuid` is preset, the bare announce is not a single shot. It is sent synchronously during `expose()`, then re-sent on a backoff schedule: first retry after 50 ms, doubling each time, capped at 1000 ms. A throwing emit during a retry is swallowed and the loop continues, so the handshake still completes once the channel recovers. The uuid is stable across retries, so a peer that already replied drops the duplicates as handshake echoes.

Only the bare announce retries; addressed replies, echoes, and `init` are each sent exactly once. A lost reply costs nothing, though: the announcer is still connectionless, keeps beaconing, and every beacon a live listener receives re-elicits a reply. This is also what lets endpoints that exposed before a [relay](/reference/relay/) was attached still connect: the unconnected side is still beaconing when the relay comes up.

The loop halts permanently as soon as the instance tracks its first connection (or its `unregisterSignal` aborts), and it never restarts, even if that connection later closes. There is no automatic reconnection: a side that has ever connected will not announce again, so re-establishing a link always requires the other side to call `expose()` again. See [lifecycle](/guides/lifecycle/).

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

Preset **both** sides: a one-sided preset deterministically half-works. The preset side's lone init arrives before the announcing side has tracked its uuid, is dropped, and is never resent; the preset side still resolves (the peer's own announce reaches it), while the announcing side stays pending forever with no error anywhere. Only use this mode over channels that queue (a `MessagePort` before `start()`) or when both ends are known to be listening.

## Handshake errors

Every handshake failure rejects `expose()` rather than hanging: an unusable transport, a circular value throwing during boxing, a malformed `init` from the peer (the revive error surfaces), or a peer `close` arriving before its `init`. The exact errors are listed in the [expose() reference](/reference/expose/#errors).

For teardown after a successful handshake (`unregisterSignal`, protocol `close`, and what survives connection death), see [lifecycle](/guides/lifecycle/).

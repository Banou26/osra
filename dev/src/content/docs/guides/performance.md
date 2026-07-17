---
title: Performance
description: What osra calls cost, how to move large binary data efficiently, and how identity() dedupes repeat sends.
---

osra's overhead is small and predictable: O(1) dispatch per message and a boxing walk per payload. This page covers where the costs are and how to avoid the avoidable ones.

## One connection, one envelope channel

Each connection runs over one envelope channel. Function calls always multiplex over it as `message` envelopes with O(1) per-`portId` dispatch on each side, and on JSON transports every live value does: adding more live values there adds routing entries in a map, not channels. On structured-clone transports, each promise, stream, and abort signal instead opens a lightweight `MessageChannel` whose port is transferred alongside the enclosing message, and its traffic rides that port; user `MessagePort`s are likewise transferred whole. See [Architecture](/internals/architecture/) for how `portId` routing works.

## Per-call cost

Each remote function call allocates:

- a synthetic return channel,
- one routing entry on each side,
- one boxing walk of the arguments.

Entries are dropped when the result settles. Chatty fine-grained calls are fine; batching is still cheaper.

## Large binary data

On structured-clone transports, wrap buffers in `transfer()` to move instead of copy: a 16 MB `ArrayBuffer` transfers without a byte copied (see [identity() and transfer()](/guides/identity-and-transfer/)).

Real `MessagePort`s and `TransformStream`s are must-transfer and always moved. `ReadableStream` and `WritableStream` are **not**: their revivable modules claim them first and replace them with a port channel, so chunks are proxied message-by-message with per-chunk boxing/copying, even under `transfer()`. For bulk binary data, prefer transferring buffers over streaming them when you can.

On JSON transports, `ArrayBuffer` and TypedArrays serialize to base64, which costs both size and CPU; `transfer()` degrades to a copy there. See [JSON vs clone transports](/internals/json-vs-clone/).

## Repeat sends: `identity()` dedupes

`identity(obj)` dedupes repeat sends: the first send ships the payload plus an id, later sends of the same reference ship only the id, and the peer reuses its cached revived value. A round-trip resolves back to your original object when the peer wraps the revived value in `identity()` on the way back. If you pass the same large object to the peer repeatedly, wrap it once in `identity()` and pay the wire cost once.

The dedup is wire-side only: every resend still runs the full local boxing walk and discards the result (for a function, that allocates a fresh call channel and routing entry that is never shipped), so `identity()` saves bandwidth and receiver-side revival work, not sender-side CPU. The peer also holds its cached revived value strongly until your original is garbage-collected or the connection closes; see [identity() and transfer()](/guides/identity-and-transfer/).

## Keep envelopes lean

Boxing walks plain objects and arrays recursively, so payload shape is a direct cost. Keep envelopes lean: send what the call needs rather than dragging large ambient structures through every payload.

---
title: Performance
description: What osra calls cost, how to move large binary data efficiently, and how identity() dedupes repeat sends.
---

osra's overhead is small and predictable: one platform channel per connection, O(1) dispatch per message, and a boxing walk per payload. This page covers where the costs are and how to avoid the avoidable ones.

## One connection, one channel

One connection = one platform channel. Every live value — functions, promises, streams, ports — multiplexes over it as `message` envelopes, with O(1) per-`portId` dispatch on each side. Adding more live values doesn't add channels; it adds routing entries in a map. See [Architecture](/internals/architecture/) for how `portId` routing works.

## Per-call cost

Each remote function call allocates:

- a synthetic return channel,
- one routing entry on each side,
- one boxing walk of the arguments.

Entries are dropped when the result settles. Chatty fine-grained calls are fine; batching is still cheaper.

## Large binary data

On structured-clone transports, wrap buffers in `transfer()` to move instead of copy — a 16 MB `ArrayBuffer` transfers without a byte copied (see [identity() and transfer()](/guides/identity-and-transfer/)).

Real `MessagePort`s are must-transfer and always moved. Streams are **not**: the stream modules claim them first and replace them with a port channel, so chunks are proxied message-by-message with per-chunk boxing/copying — even under `transfer()`. For bulk binary data, prefer transferring buffers over streaming them when you can.

On JSON transports, `ArrayBuffer` and TypedArrays serialize to base64, which costs both size and CPU; `transfer()` degrades to a copy there. See [JSON vs clone transports](/internals/json-vs-clone/).

## Repeat sends: `identity()` dedupes

`identity(obj)` dedupes repeat sends: the first send ships the payload plus an id, later sends of the same reference ship only the id, and the peer reuses its cached revived value. A round-trip resolves back to your original object. If you pass the same large object to the peer repeatedly, wrap it once in `identity()` and pay the serialization cost once.

## Keep envelopes lean

Boxing walks plain objects and arrays recursively, so payload shape is a direct cost. Keep envelopes lean: send what the call needs rather than dragging large ambient structures through every payload.

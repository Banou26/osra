---
title: Limitations
description: What osra cannot hide about the boundary between two contexts, and what to do about it.
---

osra hides most of the messaging boundary. Here is the part it cannot, and the workaround where there is one.

## Values

**Circular structures throw.** A structure containing itself fails on send with `TypeError('osra: cannot serialize a circular structure')`, and one arriving from a peer fails on receive with `TypeError('osra: cannot revive a circular structure')`. Only real cycles throw. The same object in two sibling positions is fine, it just arrives as two copies.

**Shared references duplicate.** Send one object twice and the peer gets two. Wrap it in [`identity()`](/guides/identity-and-transfer/) when that matters.

**Classes are not preserved.** Instances cross as their own data properties, without their prototype, so the methods are gone. Two sharper edges: an instance holding a function-valued own property (an arrow-function class field) coerces to `{}` entirely, data included, and osra never descends into a non-plain object, so a function nested inside a class instance is not proxied even though the same function on a plain object would be.

Use plain objects and functions, or write a [custom revivable](/guides/custom-revivables/) for the class. Built-in `Error` classes are the exception and revive properly.

**Unclonable values become `{}`.** `WeakMap`, `WeakSet` and exotic host objects have nothing to send. The [`Capable` check](/reference/typescript/) rejects them where you wrote them, so the runtime coercion is a last resort you should not hit.

**`Event` subclasses lose their extra fields.** A `MessageEvent` arrives as an `Event` with no `data`. Send the payload separately.

**Custom `Error` subclasses become `Error`.** `name`, `message`, `stack` and `cause` survive, `instanceof YourError` does not.

## Calls

**Synchronous functions become asynchronous.** `() => number` is `() => Promise<number>` on the other side. There is no way around it, the call has to cross a message boundary.

**Generic functions lose their generics.** `<T>(x: T) => T` collapses to its constraint. Expose a concrete signature per type, or accept the widening.

**Every call is a round trip.** Cheap, but not free. A loop calling a remote function ten thousand times sends twenty thousand messages. Expose a function that takes the whole batch.

**Streams and generators are single use.** osra locks a `ReadableStream` and starts a generator at send time. Sending the same one twice fails, and so does sending a `Request` or `Response` whose body already went out. Expose a function that makes a fresh one per call.

## Connections

**`expose()` resolves with the first peer.** If several peers answer on the same key, the rest still connect and can call you, but you get no handle on them. One connection per peer is the fix, see [multiple peers](/guides/multiple-peers/).

**A remote `AbortSignal` does not fire when the connection dies.** Use your own `unregisterSignal`, or the rejection of a pending call. See [lifecycle](/guides/lifecycle/).

**`expose()` waits forever for a peer that never comes.** That is what makes late-loading iframes work. Race it against a timeout if you need one.

## JSON transports

**Clone-only types are rejected.** `RegExp`, `Blob`, `File`, `FileList`, `DataView`, `SharedArrayBuffer`, `ImageBitmap` and the rest of the structured-clone family cannot cross a text protocol. The check catches it at compile time. Send an `ArrayBuffer` instead.

**Binary data is base64.** Which costs roughly a third more bytes, plus the encoding time. Prefer a clone transport for anything large.

**`transfer()` degrades to a copy.** There is no ownership to hand over. The code still runs, it just copies.

## Platform

**`Float16Array` needs both sides to have it.** A receiver without it rejects with `Error('Unknown typed array type')`.

**`TransformStream` is always moved,** never proxied, because structured clone cannot copy one. Same for `OffscreenCanvas`, `MediaStreamTrack`, `RTCDataChannel` and `MIDIAccess`.

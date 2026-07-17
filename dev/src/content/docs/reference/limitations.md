---
title: Limitations
description: Known constraints of osra's serialization and connection model, each with its workaround.
---

osra hides most of the messaging boundary, but not all of it. These constraints are inherent to the model; each has a workaround where one exists.

## Circular structures throw

A circular structure throws a `TypeError` at send time. Break the cycle or restructure — for example, send the container behind a function.

## Shared references duplicate

The same object appearing twice in a payload arrives as two copies. Wrap it with [`identity()`](/reference/identity/) to preserve reference identity across sends and round trips.

## Classes and prototypes are not preserved

Values cross as plain data; a class instance's methods are not proxied. Expose plain objects and functions, or write a [custom revivable](/guides/custom-revivables/) for the class.

## Unclonable values coerce to `{}`

`WeakMap`, `WeakSet`, and other unclonables coerce to `{}` at runtime, matching `JSON.stringify` behavior. The compile-time [`Capable` check](/reference/typescript/) flags them first.

## Bodies lock at first send

Sending the same `Request`, `Response`, or `ReadableStream` twice fails; the body locks at first send.

## Generic function type parameters collapse

Mapped types cannot preserve generic signatures, so a generic remote function loses its generics in [`Remote<T>`](/reference/typescript/).

## Multi-peer: only the first peer's value is accessible

The promise returned by `expose()` resolves with the first peer's value; later peers still connect and can call your exposed value, but there is no public accessor for their values. See [multi-peer](/guides/multi-peer/) for the expose-per-port pattern.

## Everything is async

Synchronous return values still arrive as `Promise`s; every call across the boundary is asynchronous.

## Relay capability classes must match

Relaying between a structured-clone and a JSON transport destroys embedded ports in serialization; keep both legs of a [relay()](/reference/relay/) in the same class — both structured-clone or both JSON.

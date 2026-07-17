---
title: Limitations
description: Known constraints of osra's serialization and connection model, each with its workaround.
---

osra hides most of the messaging boundary, but not all of it. These constraints are inherent to the model; each has a workaround where one exists.

## Circular structures throw

A structure that contains itself fails on the sending side: boxing throws `TypeError('osra: cannot serialize a circular structure - break the cycle or send the container by reference')`. A cyclic graph arriving from a peer (structured clone can legally deliver one) fails on the receiving side with the distinct `TypeError('osra: cannot revive a circular structure')`. Only true ancestor cycles throw: the same object at two sibling positions is allowed and arrives as two copies (see below). Break the cycle or restructure; for example, send the container behind a function.

## Shared references duplicate

The same object appearing twice in a payload arrives as two copies. Wrap it with [`identity()`](/reference/identity/) to preserve reference identity across sends and round trips.

## Classes and prototypes are not preserved

Values cross as plain data; a class instance's methods are not proxied. An instance whose own properties are all clonable data crosses as those properties, prototype methods silently dropped. An instance carrying function-valued own properties (for example arrow-function class fields) fails the structured-clone probe and coerces to `{}` entirely, own data properties included, via the unclonable path below. osra also never walks into non-plain objects, so revivables nested inside a class instance are not boxed: a function stored on a plain object works, the same function stored on a class instance does not. (Built-in `Error` classes are the exception: they revive as their own class, and other `Error` subclasses revive as base `Error` with `name`, `message`, `stack`, and `cause` preserved; see [supported types](/guides/supported-types/).) Expose plain objects and functions, or write a [custom revivable](/guides/custom-revivables/) for the class.

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

Relaying between a structured-clone and a JSON transport destroys embedded ports in serialization; keep both legs of a [relay()](/reference/relay/) in the same class: both structured-clone or both JSON.

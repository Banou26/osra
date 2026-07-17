---
title: "Remote<T> and TypeScript"
description: How Remote<T> maps your API type across the wire and how the Capable check rejects non-serializable values at compile time.
---

`Remote<T>` is the type of your value as the other side sees it: functions become async, containers map recursively, platform objects revive as themselves. At the [expose()](/reference/expose/) call site, a compile-time `Capable` check rejects values that can't cross the wire.

## The `Remote<T>` mapping

| Local type | Remote type |
|---|---|
| `(...args: P) => R` | `(...args: P) => Promise<Remote<Awaited<R>>>` |
| `Promise<U>` | `Promise<Remote<U>>` |
| `AsyncIterable<U>` | `AsyncIterableIterator<Remote<U>>` |
| `Map`, `Set`, `Date`, `Error`, `RegExp`, `ArrayBuffer`, `ArrayBufferView`, `ReadableStream`, `WritableStream`, `MessagePort`, `EventTarget`, `Request`, `Response`, `Headers`, `File`, `FileList` | itself (clone transports only; `Blob` is not supported) |
| arrays / objects | mapped recursively |
| primitives | themselves |

## Generic signatures collapse

Mapped types cannot preserve type parameters, so a generic remote function loses its generics in `Remote<T>`.

## The `Capable` compile-time check

`expose()` validates the value you pass at compile time against `Capable`, the union of everything serializable for the inferred transport. Failures pinpoint the offending path:

```ts
expose({ ok: async () => 1, cache: new WeakMap() }, { transport: worker })
// type error: Value type must resolve to a Capable, with `cache` identified as the bad field
```

The error identifies the offending path and its parent object, so a `WeakMap` buried three levels deep fails at compile time, not at runtime. (At runtime, unclonables coerce to `{}`; see [limitations](/reference/limitations/).)

Registering [custom revivables](/guides/custom-revivables/) widens the check: passing the extended module list type as the second type parameter of `expose()` teaches `Capable` that your type is now a legal value.

## JSON transports narrow `Capable`

`Capable` is narrower on JSON transports: values that depend on structured clone (`RegExp`, `SharedArrayBuffer`, `ImageBitmap`, …) are rejected at the type level, so misuse fails at compile time rather than silently coercing. Everything with a dedicated revivable module (`Date`, `Map`, `ArrayBuffer` via base64, functions, streams, …) still works; see [supported types](/guides/supported-types/) for the full matrix.

## Requirements

The package is strict-mode; the published declarations require **TypeScript ≥ 5.9** with `strict` mode.

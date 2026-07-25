---
title: TypeScript
description: How Remote<T> maps your types across the connection, and how the Capable check rejects the rest.
---

Two types do the work. `Remote<T>` describes what the peer's value looks like on your side. `Capable` describes what you are allowed to send.

You rarely write either of them. `expose()` applies both.

## Remote&lt;T&gt;

| You have | The peer sees |
|---|---|
| `(...args: P) => R` | `(...args: P) => Promise<Remote<Awaited<R>>>` |
| `Promise<U>` | `Promise<Remote<U>>` |
| `AsyncIterable<U>` | `AsyncIterableIterator<Remote<U>>` |
| `Map`, `Set`, `Date`, `Error`, `RegExp`, `ArrayBuffer` and views, `Blob`, `File`, `FileList`, `ReadableStream`, `WritableStream`, `MessagePort`, `EventTarget`, `Request`, `Response`, `Headers` | itself |
| Arrays and objects | mapped field by field |
| Everything else | itself |

Only two rules really matter: functions become async, and everything else stays what it was.

Three edges worth knowing:

**Anything shaped like an `EventTarget` passes through unmapped.** The pass-through row matches structurally, so an `AbortSignal`, a `Worker`, or your own class with `addEventListener` and `dispatchEvent` keeps its exact type. Its methods will still be async at runtime, the type just does not say so.

**Generic functions lose their generics.** Mapped types cannot carry type parameters, so `<T>(x: T) => T` collapses.

**`Remote<unknown>` is `unknown`.** Calling `expose()` with no type argument gives you `Promise<unknown>`, which is the compiler telling you it has no idea what the peer sent.

## The Capable check

`expose()` checks your value against `Capable`, the set of everything sendable over the transport you passed. Anything else is a compile error where you wrote it, pointing at the field:

```ts twoslash
// @errors: 2345
import { expose } from 'osra'
declare const worker: Worker
// ---cut---
expose({ ok: async () => 1, cache: new WeakMap() }, { transport: worker })
```

The error carries the bad value, its path, and its parent object, so a `WeakMap` buried three objects deep is reported at the `expose()` call rather than turning into `{}` at runtime.

One gap: inside a plain array the report stops at the array itself, so you get the array as the bad value and a path that ends there. Tuples are reported element by element.

## JSON transports check harder

`Capable` narrows with the transport. On a JSON transport, everything that depends on structured clone is not a legal value, so this fails before it can fail at runtime:

```ts twoslash
// @errors: 2345
import { expose } from 'osra'
// ---cut---
expose({ foo: new File([], '') }, { transport: new WebSocket('') })
```

The same code with a `Worker` transport compiles. That is the whole point: the check knows which channel you are on.

Types with a dedicated module (`Date`, `Map`, `ArrayBuffer`, functions, streams) work on both modes. See [supported types](/guides/supported-types/) for the split.

## Custom types

Registering a [custom revivable](/guides/custom-revivables/) widens `Capable`, as long as you tell the call site about it:

```ts
expose<PeerApi, ReturnType<typeof myModules>>(value, {
  transport,
  revivableModules: myModules
})
```

Without the second type argument the modules still work at runtime, but the check does not know about them and will reject your type.

## Requirements

TypeScript 5.9 or newer, with `strict` on. The types lean on that heavily.

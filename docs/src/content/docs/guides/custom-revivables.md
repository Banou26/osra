---
title: Custom revivables
description: Teach osra how to send a type it does not know, like your own class.
---

Every type osra supports is a small module: a guard, a way to flatten the value, and a way to rebuild it. The built-in list is just an array of those, and you can add to it.

This is also the answer to "classes are not preserved". They are not, by default, because osra cannot know how to rebuild yours. Tell it, and they are.

## A module

```ts twoslash
import type { RevivableContext, RevivableModule } from 'osra'
import { BoxBase } from 'osra'

class Point {
  constructor(public x: number, public y: number) {}
  distance() { return Math.hypot(this.x, this.y) }
}

const point = {
  type: 'point' as const,
  isType: (value: unknown): value is Point => value instanceof Point,
  box: (value: Point, _context: RevivableContext) => ({
    ...BoxBase,
    type: 'point' as const,
    x: value.x,
    y: value.y
  }),
  revive: (value: { x: number, y: number }, _context: RevivableContext) =>
    new Point(value.x, value.y)
} as const satisfies RevivableModule
```

- `type` names the box on the wire. It has to be unique in the list.
- `isType` decides whether this module handles a value on the way out.
- `box` turns it into something sendable. Spread `BoxBase` so osra recognises the result as a box, and keep `type` on it.
- `revive` rebuilds it on the other side.

Whatever `box` returns is itself boxed recursively, so the fields can hold anything osra already supports: a `Date`, a function, a stream, another `Point`.

## Using it

`revivableModules` takes the default list and returns the one you want.

```ts twoslash
// @filename: point.ts
import type { RevivableContext, RevivableModule } from 'osra'
import { BoxBase } from 'osra'
export class Point {
  constructor(public x: number, public y: number) {}
  distance() { return Math.hypot(this.x, this.y) }
}
export const point = {
  type: 'point' as const,
  isType: (value: unknown): value is Point => value instanceof Point,
  box: (value: Point, _context: RevivableContext) => ({
    ...BoxBase, type: 'point' as const, x: value.x, y: value.y
  }),
  revive: (value: { x: number, y: number }, _context: RevivableContext) =>
    new Point(value.x, value.y)
} as const satisfies RevivableModule
// @filename: main.ts
declare const transport: Worker
// ---cut---
import type { RevivableModule } from 'osra'
import { expose } from 'osra'
import { Point, point } from './point'

const withPoint = <TDefaults extends readonly RevivableModule[]>(defaults: TDefaults) =>
  [point, ...defaults] as const

const payload = { scale: (p: Point) => new Point(p.x * 2, p.y * 2) }

expose(payload, { transport, revivableModules: withPoint })

const remote = await expose<typeof payload, ReturnType<typeof withPoint>>(
  {},
  { transport, revivableModules: withPoint }
)

const doubled = await remote.scale(new Point(3, 4))
doubled.distance() // 10, a real Point with its methods
```

Pass the module list as the second type argument so the `Capable` check knows about your type. Without it, `Point` is not a value osra thinks it can send, and the call site will say so.

**Both sides need the same list.** The peer needs your `revive` to rebuild the value, and the same `type` string to find it.

## Ordering

Boxing walks the list in order and takes the first `isType` that matches. Reviving matches on `type`, so order does not matter there.

Putting your module first, like above, lets it win over the defaults. That is what you want when your class extends something a default already handles, an `Error` subclass for example, and you want your own fields to survive.

Dropping or replacing a default works the same way, since you get the whole list and return whatever you like:

```ts twoslash
import type { RevivableModule } from 'osra'
declare const myDate: RevivableModule
// ---cut---
const modules = <T extends readonly RevivableModule[]>(defaults: T) =>
  [myDate, ...defaults.filter(m => m.type !== 'date')] as const
```

Be careful reordering the defaults. A few of them depend on their position: the `eventTarget` module sits last because `MessagePort`, `AbortSignal` and `Window` all extend `EventTarget` and need first pick, and the catch-all that turns unclonable values into `{}` sits after everything.

## Nested values

To box a field yourself, use `recursiveBox` and `recursiveRevive` with the context you were handed:

```ts twoslash
import type { RevivableContext } from 'osra'
import { BoxBase, recursiveBox, recursiveRevive } from 'osra'

class Result {
  constructor(public value: unknown, public at: Date) {}
}
// ---cut---
const result = {
  type: 'result' as const,
  isType: (value: unknown): value is Result => value instanceof Result,
  box: (value: Result, context: RevivableContext) => ({
    ...BoxBase,
    type: 'result' as const,
    value: recursiveBox(value.value as never, context),
    at: recursiveBox(value.at as never, context)
  }),
  revive: (value: { value: unknown, at: unknown }, context: RevivableContext) =>
    new Result(
      recursiveRevive(value.value as never, context),
      recursiveRevive(value.at as never, context) as unknown as Date
    )
}
```

In practice you rarely need this. Returning a plain object from `box` gets the same result, because osra descends into it anyway.

## The context

Both `box` and `revive` receive the connection context:

| Field | |
|---|---|
| `transport` | The normalized transport, useful for `isJsonOnlyTransport(context.transport)` when your encoding differs per mode. |
| `remoteUuid` | The peer this connection belongs to. |
| `sendMessage` | Send your own message type. Pair it with the optional `init(context)` hook and a listener on `eventTarget` for anything that needs a live channel. |
| `eventTarget` | Incoming messages for this connection. |
| `revivableModules` | The resolved module list. |

Modules with a live side (functions, streams, ports) all work this way. Read `src/revivables/` if you need one, they are short.

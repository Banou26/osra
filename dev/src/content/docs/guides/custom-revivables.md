---
title: Custom revivables
description: Teach osra to carry your own types across the wire by writing a RevivableModule.
---

Classes and prototypes are not preserved by default; values cross as plain data. A **revivable module** fixes that for a type you own: it tells osra how to recognize the value, flatten it into a serializable box, and reconstruct it on the other side.

## Anatomy of a `RevivableModule`

A revivable module owns one type: `type` (unique string, identical on both sides), `isType` (runtime guard used for boxing), `box` (value → JSON/clone-safe box), `revive` (box → value), and optionally `init` (per-connection setup):

```ts
type RevivableModule = {
  readonly type: string
  readonly isType: (value: unknown) => value is T
  readonly box: (value: T, context: RevivableContext) => BoxBase & { type: string }
  readonly revive: (boxed, context: RevivableContext) => T
  readonly init?: (context: RevivableContext) => void
}
```

`box` turns a matched value into a plain serializable box (spread `BoxBase` in to tag it); `revive` reconstructs it on the other side. `context` gives access to `sendMessage`/`eventTarget` for modules that need their own wire traffic, and `recursiveBox`/`recursiveRevive` (exported) handle nested values.

## Example: preserving a class instance

```ts twoslash
import type { RevivableContext, RevivableModule } from 'osra'
import { expose, BoxBase } from 'osra'

class Point {
  constructor(public x: number, public y: number) {}
  distance() {
    return Math.sqrt(this.x ** 2 + this.y ** 2)
  }
}

const pointModule = {
  type: 'point' as const,
  isType: (value: unknown): value is Point => value instanceof Point,
  box: (value: Point, _context: RevivableContext) => ({
    ...BoxBase,
    type: 'point' as const,
    x: value.x,
    y: value.y,
  }),
  revive: (value: { x: number, y: number }, _context: RevivableContext) =>
    new Point(value.x, value.y),
} as const satisfies RevivableModule

const withPoint = <TDefaults extends readonly RevivableModule[]>(defaults: TDefaults) =>
  [pointModule, ...defaults] as const
```

The `revivableModules` option of [`expose()`](/reference/expose/) is a function over the default module list; here `withPoint` prepends `pointModule` and keeps the defaults intact.

## Register on both sides

Both sides must register the same modules; the second type parameter of `expose` carries the extended module list into the `Capable` check:

```ts twoslash
import type { RevivableContext, RevivableModule } from 'osra'
import { expose, BoxBase } from 'osra'

class Point {
  constructor(public x: number, public y: number) {}
  distance() {
    return Math.sqrt(this.x ** 2 + this.y ** 2)
  }
}

const pointModule = {
  type: 'point' as const,
  isType: (value: unknown): value is Point => value instanceof Point,
  box: (value: Point, _context: RevivableContext) => ({
    ...BoxBase,
    type: 'point' as const,
    x: value.x,
    y: value.y,
  }),
  revive: (value: { x: number, y: number }, _context: RevivableContext) =>
    new Point(value.x, value.y),
} as const satisfies RevivableModule

const withPoint = <TDefaults extends readonly RevivableModule[]>(defaults: TDefaults) =>
  [pointModule, ...defaults] as const

declare const transport: Worker
// ---cut---
const value = async (p: Point) => new Point(p.x * 2, p.y * 2)
expose(value, { transport, revivableModules: withPoint })

const remote = await expose<typeof value, ReturnType<typeof withPoint>>(
  {},
  { transport, revivableModules: withPoint },
)
const doubled = await remote(new Point(3, 4)) // instanceof Point, distance() === 10
```

Passing the module list type as the second type parameter (`ReturnType<typeof withPoint>`) teaches the [`Capable` check](/reference/typescript/) that `Point` is now a legal value.

## Ordering matters

Boxing picks the *first* module whose `isType` matches, so prepend your module ahead of the defaults; otherwise a fallback (`clonable`, `eventTarget`, the `unclonable` catch-all) may claim your instances first. The default list itself is order-sensitive for the same reason.

The `revivableModules` function receives the defaults and returns the final ordered list, so you can also drop, reorder, or replace built-ins, not just prepend.

## Box contents and nested values

A box must spread `BoxBase` (`{ __OSRA_BOX__: 'revivable' }`) and carry only JSON/clone-safe fields; see the [wire protocol](/reference/wire-protocol/) for how boxes travel inside envelopes.

Nested capable values are **not** walked for you; call `recursiveBox`/`recursiveRevive` with the provided context. When your type needs a live channel, box a function or `MessagePort` through `recursiveBox` and embed the resulting box.

:::note
The lower-level `createRevivableChannel` helper behind promises and streams is internal: not re-exported, and `package.json` `exports` blocks deep imports.
:::

import type { Transport } from '../../src/types'
import type { RevivableContext, RevivableModule } from '../../src/index'

import { expect } from 'chai'

import { expose, identity, BoxBase } from '../../src/index'

/**
 * Passing `identity(fn)` twice as two args to a single call should produce
 * the same revived reference on the receiving side, because the second box
 * of the same wrapper emits a ref-only box that the receiver resolves from
 * its local cache.
 */
export const identityPreservedAsArgs = async (transport: Transport) => {
  const value = {
    compare: async (a: () => number, b: () => number) => a === b,
  }
  expose(value, { transport })
  const { compare } = await expose<typeof value>({}, { transport })

  const fn = () => 42
  await expect(compare(identity(fn), identity(fn))).to.eventually.equal(true)
}

/**
 * The wrapper cache is keyed on inner values and survives across multiple
 * RPC calls on the same connection, so `identity(fn)` called in two
 * separate RPCs on the same connection also reaches the receiver as the
 * same cached reference.
 */
export const identityPreservedAcrossCalls = async (transport: Transport) => {
  let lastReceived: (() => number) | null = null
  const value = {
    record: async (fn: () => number) => {
      const sameAsBefore = lastReceived === fn
      lastReceived = fn
      return sameAsBefore
    },
  }
  expose(value, { transport })
  const { record } = await expose<typeof value>({}, { transport })

  const fn = () => 42
  await expect(record(identity(fn))).to.eventually.equal(false) // first call: nothing cached yet
  await expect(record(identity(fn))).to.eventually.equal(true)  // second call: same ref via cache
}

/**
 * Values that are NOT wrapped in `identity()` continue to behave like they
 * did before — each send produces a fresh revived instance on the
 * receiving side. This is the default osra semantics for functions and
 * every other revivable type.
 */
export const noIdentityWithoutWrapper = async (transport: Transport) => {
  const value = {
    compare: async (a: () => number, b: () => number) => a === b,
  }
  expose(value, { transport })
  const { compare } = await expose<typeof value>({}, { transport })

  const fn = () => 42
  await expect(compare(fn, fn)).to.eventually.equal(false)
}

/**
 * `identity()` is idempotent: calling it twice on the same inner value
 * returns the same wrapper instance, so call sites don't have to store the
 * wrapper to get dedup.
 */
export const identityIdempotent = async (_transport: Transport) => {
  const fn = () => 42
  expect(identity(fn)).to.equal(identity(fn))
  // Wrapping an already-wrapped value returns the same wrapper (no double
  // wrapping).
  expect(identity(identity(fn))).to.equal(identity(fn))
}

/**
 * Primitives have no identity to preserve and WeakMap can't key on them,
 * so `identity()` returns them as-is.
 */
export const identityPrimitivesPassThrough = async (_transport: Transport) => {
  expect(identity(42)).to.equal(42)
  expect(identity('hello')).to.equal('hello')
  expect(identity(true)).to.equal(true)
  expect(identity(null)).to.equal(null)
  expect(identity(undefined)).to.equal(undefined)
}

// ---- identity() composes with user custom revivables ----

class Point {
  constructor(public x: number, public y: number) {}
}

const pointModule = {
  type: 'identityPoint' as const,
  isType: (value: unknown): value is Point => value instanceof Point,
  box: (value: Point, _context: RevivableContext) => ({
    ...BoxBase,
    type: 'identityPoint' as const,
    x: value.x,
    y: value.y,
  }),
  revive: (value: { x: number, y: number }, _context: RevivableContext) =>
    new Point(value.x, value.y),
} as const satisfies RevivableModule

/**
 * `identity()` wraps a user-custom revivable's instance. The second send
 * emits a ref-only box; the receiver resolves it from the cache and
 * returns the same revived Point instance. The inner Point's own revivable
 * module runs only on the first box/revive pair.
 */
export const identityPreservedForUserClass = async (transport: Transport) => {
  const value = {
    compare: async (a: Point, b: Point) => a === b,
  }
  expose(value, { transport, revivableModules: [pointModule] })
  const { compare } = await expose<typeof value>(
    {},
    { transport, revivableModules: [pointModule] },
  )

  const p = new Point(3, 4)
  await expect(compare(identity(p), identity(p))).to.eventually.equal(true)
}

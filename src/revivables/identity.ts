// src/revivables/identity.ts
//
// The `identity` revivable is a user-invoked wrapper that asks osra to
// preserve the reference of a value as it crosses an osra connection. When
// you pass the same wrapped value twice over the same connection, the
// receiving side reuses the same revived reference both times — which is
// what makes patterns like `addEventListener(fn) + removeEventListener(fn)`
// work across an RPC boundary.
//
// Usage:
//
//   import { identity } from 'osra'
//
//   const fn = () => console.log('hi')
//   await remote.addListener('foo', identity(fn))
//   await remote.removeListener('foo', identity(fn))  // ref-only on the wire
//
// Semantics:
//
// - `identity()` is memoized per inner value: `identity(fn) === identity(fn)`.
//   This means you can call it inline at each send site without worrying
//   about wrapper lifetime — the same inner reference always produces the
//   same wrapper.
// - Primitive inputs pass through unchanged (primitives have no identity to
//   preserve, and WeakMap can't key on them).
// - The return value is a wrapper object, NOT the original value. Locally
//   it's only useful as an argument to osra RPC — the remote side receives
//   the unwrapped revived value. The TypeScript signature returns `T` as a
//   deliberate type lie so calls read as if you were passing the original.
// - `identity()` is idempotent: `identity(identity(fn))` returns the same
//   wrapper as `identity(fn)`.
//
// Non-wrapped values continue to cross the wire with clone-ish semantics
// (a fresh revived instance each time), exactly as before. Only values you
// explicitly wrap in `identity()` incur any bookkeeping overhead.

import type { Capable, Uuid } from '../types'
import type { RevivableContext, BoxBase as BoxBaseType } from './utils'

import { BoxBase } from './utils'
import { recursiveBox, recursiveRevive } from '.'

export const type = 'identity' as const

/**
 * Symbol-keyed brand for identity wrappers. Present on every wrapper
 * produced by `identity()`; absent on every other value. Using a symbol
 * (rather than a class or a string key) means wrappers are indistinguishable
 * from plain objects to anything except our own `isType` check.
 */
const IDENTITY_BRAND: unique symbol = Symbol('osra.identity')

type IdentityWrapper<T> = {
  readonly [IDENTITY_BRAND]: true
  readonly inner: T
}

/**
 * Global memoization: one wrapper per inner value. Keyed weakly on the
 * inner value so both entries are freed when the inner value is garbage
 * collected.
 */
const wrapperCache = new WeakMap<object, IdentityWrapper<unknown>>()

/**
 * Wrap a value so osra preserves its reference across RPC boundaries.
 * See the module header comment for semantics and usage.
 */
export const identity = <T>(value: T): T => {
  // Primitives have no identity — return as-is.
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) {
    return value
  }
  // Idempotent: already-wrapped values return themselves.
  if ((value as Record<symbol, unknown>)[IDENTITY_BRAND] === true) {
    return value
  }
  const existing = wrapperCache.get(value as object)
  if (existing) return existing as unknown as T
  const wrapper: IdentityWrapper<T> = {
    [IDENTITY_BRAND]: true,
    inner: value,
  }
  wrapperCache.set(value as object, wrapper as IdentityWrapper<unknown>)
  // Type lie: the actual runtime value is `IdentityWrapper<T>`, but the
  // caller treats the return as `T` for call-site ergonomics.
  return wrapper as unknown as T
}

export type BoxedIdentity =
  & BoxBaseType<typeof type>
  & (
    | { id: Uuid, inner: Capable, ref?: undefined }
    | { id: Uuid, ref: true, inner?: undefined }
  )

export const isType = (value: unknown): value is IdentityWrapper<unknown> =>
  value !== null
  && typeof value === 'object'
  && (value as Record<symbol, unknown>)[IDENTITY_BRAND] === true

export const box = <T, T2 extends RevivableContext>(
  value: IdentityWrapper<T>,
  context: T2,
): BoxedIdentity => {
  const wrapperObj = value as unknown as object

  // Have we boxed this wrapper before on this connection? If so, emit a
  // ref-only box — the receiver will resolve it through its cache.
  const existing = context.outgoingIdentityIds.get(wrapperObj)
  if (existing !== undefined) {
    return {
      ...BoxBase,
      type,
      id: existing,
      ref: true,
    } as BoxedIdentity
  }

  // First box of this wrapper: allocate an id, box the inner value, and
  // record the mapping for future ref-only emissions.
  const id = globalThis.crypto.randomUUID()
  const boxedInner = recursiveBox(value.inner as Capable, context)
  context.outgoingIdentityIds.set(wrapperObj, id)
  context.outgoingIdentitiesById.set(id, new WeakRef(wrapperObj))
  return {
    ...BoxBase,
    type,
    id,
    inner: boxedInner,
  } as BoxedIdentity
}

export const revive = <T2 extends RevivableContext>(
  boxed: BoxedIdentity,
  context: T2,
): unknown => {
  // Ref-only: look up the cache. The corresponding full box was revived on
  // an earlier message and the revived value is (hopefully) still alive.
  if (boxed.ref === true) {
    const cached = context.revivedIdentitiesById.get(boxed.id)?.deref()
    if (cached) return cached
    throw new Error(
      `osra: identity ref-only box for id ${boxed.id} has no cached revived value on this side. ` +
      `Possible race between an identity-drop GC notification and a concurrent re-box.`,
    )
  }

  // Full box: check the cache first (concurrent revive may have landed), then
  // revive the inner value, cache by id, and register for cleanup.
  const existing = context.revivedIdentitiesById.get(boxed.id)?.deref()
  if (existing) return existing

  const revived = recursiveRevive(boxed.inner as Capable, context)
  if (revived !== null && (typeof revived === 'object' || typeof revived === 'function')) {
    context.revivedIdentitiesById.set(boxed.id, new WeakRef(revived as object))
    context.identityCleanupRegistry.register(revived as object, boxed.id, revived as object)
  }
  return revived
}

import type { Transport } from '../../src/types'

import { expect } from 'chai'

import { expose, identity } from '../../src/index'

// 1. Same wrapped value → same revived reference across two arguments of one RPC
export const sameReferenceAcrossArgs = async (transport: Transport) => {
  const value = async (a: () => number, b: () => number) => a === b
  expose(value, { transport })

  const test = await expose<typeof value>({}, { transport })

  const fn = () => 42
  const result = await test(identity(fn), identity(fn))
  expect(result).to.equal(true)
}

// 2. Same wrapped value → same revived reference across separate RPCs
export const sameReferenceAcrossCalls = async (transport: Transport) => {
  let captured: unknown
  const value = {
    capture: async (fn: () => number) => {
      captured = fn
      return fn
    },
    compare: async (fn: () => number) => fn === captured,
  }
  expose(value, { transport })

  const remote = await expose<typeof value>({}, { transport })

  const fn = () => 42
  await remote.capture(identity(fn))
  const result = await remote.compare(identity(fn))
  expect(result).to.equal(true)
}

// 3. addEventListener / removeEventListener pattern — a listener registered
// with identity() can be unregistered with identity() on the same value.
export const addRemoveEventListenerPattern = async (transport: Transport) => {
  // Use a Set<listener>, which matches identity-based
  // add/remove semantics (a Set keys by reference).
  const listeners = new Set<() => Promise<void>>()
  const value = {
    add: async (listener: () => Promise<void>) => {
      listeners.add(listener)
    },
    remove: async (listener: () => Promise<void>) => {
      listeners.delete(listener)
    },
    fireAll: async () => {
      // Await every listener so the caller knows the fan-out finished
      // before we return.
      for (const listener of listeners) await listener()
    },
  }
  expose(value, { transport })

  const remote = await expose<typeof value>({}, { transport })

  let callCount = 0
  const handler = async () => { callCount++ }

  await remote.add(identity(handler))
  await remote.fireAll()
  expect(callCount).to.equal(1)

  await remote.remove(identity(handler))
  await remote.fireAll()
  // Removal worked: the second fire did NOT invoke the handler, because
  // remove() saw the same revived reference as add() did.
  expect(callCount).to.equal(1)
}

// 4. Unwrapped values are unchanged — two sends still produce different refs
export const unwrappedValuesClone = async (transport: Transport) => {
  const value = async (a: () => number, b: () => number) => a === b
  expose(value, { transport })

  const test = await expose<typeof value>({}, { transport })

  const fn = () => 42
  const result = await test(fn, fn)
  // Today's behavior: two sends of the same fn produce two different revived refs
  expect(result).to.equal(false)
}

// 5. identity() is idempotent and memoized
export const identityIdempotentMemoized = async (_transport: Transport) => {
  const fn = () => 42
  expect(identity(fn)).to.equal(identity(fn))
  expect(identity(identity(fn))).to.equal(identity(fn))

  const obj = { a: 1 }
  expect(identity(obj)).to.equal(identity(obj))
  expect(identity(identity(obj))).to.equal(identity(obj))
}

// 6. Primitives pass through unchanged
export const primitivesPassThrough = async (_transport: Transport) => {
  expect(identity(42)).to.equal(42)
  expect(identity('hi')).to.equal('hi')
  expect(identity(null)).to.equal(null)
  expect(identity(undefined)).to.equal(undefined)
  expect(identity(true)).to.equal(true)
  expect(identity(0)).to.equal(0)
  expect(identity('')).to.equal('')
}

// 7. Works with custom class instances — reference preserved on receiver
export const identityWithFunctionStillCallable = async (transport: Transport) => {
  const value = async (fn: () => number) => fn()
  expose(value, { transport })

  const test = await expose<typeof value>({}, { transport })

  const fn = () => 42
  const result = await test(identity(fn))
  expect(result).to.equal(42)
}

// 8. Used twice on same identity(fn) — both refs === on receiver, still callable
export const identityTwiceAcrossCallsCallable = async (transport: Transport) => {
  let captured: (() => number) | undefined
  const value = {
    capture: async (fn: () => number) => {
      captured = fn
    },
    compareAndCall: async (fn: () => number) => ({
      same: fn === captured,
      result: await fn(),
    }),
  }
  expose(value, { transport })

  const remote = await expose<typeof value>({}, { transport })

  const fn = () => 99
  await remote.capture(identity(fn))
  const { same, result } = await remote.compareAndCall(identity(fn))
  expect(same).to.equal(true)
  expect(result).to.equal(99)
}

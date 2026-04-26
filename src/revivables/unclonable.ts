import type { BoxBase as BoxBaseType, RevivableContext } from './utils'

import { BoxBase } from './utils'

export const type = 'unclonable' as const

export type BoxedUnclonable = BoxBaseType<typeof type>

/** True for plain objects whose own-property iteration via `Object.entries`
 *  is what `descend()` recurses into. We skip these in the unclonable
 *  probe because each property will be re-tested when `recursiveBox`
 *  walks back into the children. */
const isPlainObject = (value: unknown): boolean => {
  if (value === null || typeof value !== 'object') return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

/** Decide if a value should be coerced to `{}` because the wire would
 *  otherwise blow up on it. The runtime is the source of truth — we
 *  hand the value to `structuredClone` and let the engine answer "is
 *  this clonable?" rather than maintaining a hand-rolled list of known
 *  unclonable types.
 *
 *  Fast paths (primitives, arrays, plain objects, and anything earlier
 *  modules already claim via `findBoxModule`'s short-circuit) never
 *  reach the probe — `findBoxModule` only falls into this module when
 *  no other module's `isType` matched, and the cheap typeof / shape
 *  checks here exit before `structuredClone` runs. The probe itself
 *  fires only for genuinely exotic values (host objects we don't
 *  recognise, custom classes that throw on clone, weak collections,
 *  etc.) — bounded cost in real messages.
 *
 *  Symbols are special-cased because they're primitives (not objects)
 *  but `structuredClone(Symbol())` throws — caught by typeof so we
 *  don't have to construct a probe call for every symbol value. */
const isUnclonable = (value: unknown): boolean => {
  if (value === null) return false
  const t = typeof value
  if (t === 'symbol') return true
  if (t !== 'object') return false
  if (Array.isArray(value)) return false
  if (isPlainObject(value)) return false
  try {
    structuredClone(value)
    return false
  } catch {
    return true
  }
}

/** Type-level lie: returns `value is never` so this module doesn't widen
 *  the `Capable` union. Coercion to `{}` is a best-effort runtime
 *  rescue — `WeakMap`, `Symbol` etc. aren't *meaningfully* clonable
 *  and shouldn't show up in user-facing type APIs. The runtime
 *  predicate still matches at the `findBoxModule` iteration; the type
 *  system just pretends nothing matches so user code that tries to
 *  pass an unclonable value still gets a compile-time error. */
export const isType = isUnclonable as (value: unknown) => value is never

// Boxing as an empty marker lets the receiver see `{}` on either
// transport — matches what `JSON.stringify(new WeakMap())` returns
// natively, and prevents the otherwise-fatal DataCloneError on a clone
// transport.
export const box = (_value: never, _context: RevivableContext): BoxedUnclonable => ({
  ...BoxBase,
  type,
})

export const revive = (_value: BoxedUnclonable, _context: RevivableContext): Record<string, never> =>
  ({})

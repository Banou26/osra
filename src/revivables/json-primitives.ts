import type { BoxBase as BoxBaseType, RevivableContext } from './utils.js'

import { BoxBase } from './utils.js'
import { isJsonOnlyTransport } from '../utils/type-guards.js'

// JSON.stringify silently corrupts these: NaN/±Infinity become null,
// undefined vanishes from objects and becomes null in arrays. On clone
// transports both pass through untouched (box returns the raw value, so
// isRevivableBox is false and revive is never reached) — the wire shape
// only exists on JSON transports.

export type BoxedNonFiniteNumber = BoxBaseType<'nonFiniteNumber'> & { value: 'NaN' | 'Infinity' | '-Infinity' }

export const nonFiniteNumber = {
  type: 'nonFiniteNumber',
  isType: (value: unknown): value is number =>
    typeof value === 'number' && !Number.isFinite(value),
  box: (value: number, context: RevivableContext<any>): BoxedNonFiniteNumber | number =>
    isJsonOnlyTransport(context.transport)
      ? { ...BoxBase, type: 'nonFiniteNumber', value: String(value) as BoxedNonFiniteNumber['value'] }
      : value,
  revive: (value: BoxedNonFiniteNumber, _context: RevivableContext<any>): number =>
    Number(value.value),
} as const

export type BoxedUndefined = BoxBaseType<'undefined'>

export const undefinedValue = {
  type: 'undefined',
  isType: (value: unknown): value is undefined =>
    value === undefined,
  box: (value: undefined, context: RevivableContext<any>): BoxedUndefined | undefined =>
    isJsonOnlyTransport(context.transport)
      ? { ...BoxBase, type: 'undefined' }
      : value,
  revive: (_value: BoxedUndefined, _context: RevivableContext<any>): undefined =>
    undefined,
} as const

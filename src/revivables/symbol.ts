import type { RevivableContext } from './utils.js'

import { BoxBase } from './utils.js'
import { boxByReference } from './identity.js'

export const type = 'symbol' as const

export const isType = (value: unknown): value is symbol =>
  typeof value === 'symbol'

export const box = <T extends symbol, T2 extends RevivableContext>(
  value: T,
  context: T2,
) => {
  // Registry symbols carry global identity through their key.
  const registryKey = Symbol.keyFor(value)
  if (registryKey !== undefined) return { ...BoxBase, type, registryKey }
  // Everything else routes through identity so the same symbol revives to
  // the same symbol on every send (and round-trips to the original).
  return boxByReference(value, { ...BoxBase, type, description: value.description }, context)
}

export const revive = <
  T extends { registryKey: string } | { description: string | undefined },
  T2 extends RevivableContext,
>(
  value: T,
  _context: T2,
): symbol =>
  'registryKey' in value
    ? Symbol.for(value.registryKey)
    : Symbol(value.description)

const typeCheck = () => {
  const boxed = box(Symbol('foo'), {} as RevivableContext)
  const revivedDescribed = revive({ description: 'foo' }, {} as RevivableContext)
  const expected: symbol = revivedDescribed
  const revivedRegistered = revive({ registryKey: 'foo' }, {} as RevivableContext)
  const expectedRegistered: symbol = revivedRegistered
  // @ts-expect-error - not a string
  const notString: string = revivedDescribed
  // @ts-expect-error - cannot box non-symbol
  box('not a symbol', {} as RevivableContext)
}

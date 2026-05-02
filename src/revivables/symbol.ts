import type { RevivableContext } from './utils'

import { BoxBase } from './utils'
import { boxByReference } from './identity'

export const type = 'symbol' as const

export const isType = (value: unknown): value is symbol =>
  typeof value === 'symbol'

export const box = <T extends symbol, T2 extends RevivableContext>(
  value: T,
  context: T2,
) => {
  // Anonymous symbols can't round-trip via description — pass by reference
  // through identity so the same symbol on either side resolves to one ref.
  if (value.description === undefined) {
    return boxByReference(
      value,
      { ...BoxBase, type, description: undefined },
      context,
    )
  }
  return {
    ...BoxBase,
    type,
    description: value.description,
  }
}

export const revive = <T extends { description: string | undefined }, T2 extends RevivableContext>(
  value: T,
  _context: T2,
): symbol => Symbol(value.description)

const typeCheck = () => {
  const boxed = box(Symbol('foo'), {} as RevivableContext)
  // Description-bearing symbols still round-trip through this revive.
  const revived = revive({ description: 'foo' }, {} as RevivableContext)
  const expected: symbol = revived
  // @ts-expect-error - not a string
  const notString: string = revived
  // @ts-expect-error - cannot box non-symbol
  box('not a symbol', {} as RevivableContext)
}

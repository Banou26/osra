import type { RevivableContext } from './utils'

import { BoxBase } from './utils'

export const type = 'symbol' as const

export const isType = (value: unknown): value is symbol =>
  typeof value === 'symbol'

export const box = <T extends symbol, T2 extends RevivableContext>(
  value: T,
  _context: T2,
) => ({
  ...BoxBase,
  type,
  description: value.description,
})

export const revive = <T extends ReturnType<typeof box>, T2 extends RevivableContext>(
  value: T,
  _context: T2,
): symbol => Symbol(value.description)

const typeCheck = () => {
  const boxed = box(Symbol('foo'), {} as RevivableContext)
  const revived = revive(boxed, {} as RevivableContext)
  const expected: symbol = revived
  // @ts-expect-error - not a string
  const notString: string = revived
  // @ts-expect-error - cannot box non-symbol
  box('not a symbol', {} as RevivableContext)
}

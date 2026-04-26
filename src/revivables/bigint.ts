import type { RevivableContext } from './utils'

import { BoxBase } from './utils'

export const type = 'bigint' as const

export const isType = (value: unknown): value is bigint =>
  typeof value === 'bigint'

export const box = <T extends bigint, T2 extends RevivableContext>(
  value: T,
  _context: T2,
) => ({
  ...BoxBase,
  type,
  value: value.toString(),
})

export const revive = <T extends ReturnType<typeof box>>(
  value: T,
  _context: RevivableContext,
) => BigInt(value.value)

const typeCheck = () => {
  const boxed = box(123n, {} as RevivableContext)
  const revived = revive(boxed, {} as RevivableContext)
  const expected: bigint = revived
  // @ts-expect-error - not a string
  const notString: string = revived
  // @ts-expect-error - cannot box non-bigint
  box('not a bigint', {} as RevivableContext)
}

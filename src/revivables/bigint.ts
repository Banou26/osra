import type { RevivableContext, UnderlyingType } from './utils'

import { BoxBase } from './utils'

export const type = 'bigint' as const

type BoxedBigInt<T extends bigint> =
  & typeof BoxBase
  & { type: typeof type }
  & { value: string }
  & { [UnderlyingType]: T }

export const isType = (value: unknown): value is bigint =>
  typeof value === 'bigint'

export const box = <T extends bigint, T2 extends RevivableContext>(
  value: T,
  _context: T2,
): BoxedBigInt<T> =>
  ({ ...BoxBase, type, value: value.toString() }) as BoxedBigInt<T>

export const revive = <T extends BoxedBigInt<bigint>>(
  value: T,
  _context: RevivableContext,
): T[UnderlyingType] =>
  BigInt(value.value) as T[UnderlyingType]

const typeCheck = () => {
  const boxed = box(123n, {} as RevivableContext)
  const revived = revive(boxed, {} as RevivableContext)
  const expected: bigint = revived
  // @ts-expect-error - not a string
  const notString: string = revived
  // @ts-expect-error - cannot box non-bigint
  box('not a bigint', {} as RevivableContext)
}

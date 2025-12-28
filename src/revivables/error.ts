import type { RevivableContext } from './utils'

import { BoxBase } from './utils'

export const type = 'error' as const

export const isType = (value: unknown): value is Error =>
  value instanceof Error

export const box = <T extends Error, T2 extends RevivableContext>(
  value: T,
  _context: T2
) => ({
  ...BoxBase,
  type,
  message: value.message,
  stack: value.stack || value.toString()
})

export const revive = <T extends ReturnType<typeof box>, T2 extends RevivableContext>(
  value: T,
  _context: T2
) => new Error(value.message, { cause: value.stack })

const typeCheck = () => {
  const boxed = box(new Error('test'), {} as RevivableContext)
  const revived = revive(boxed, {} as RevivableContext)
  const expected: Error = revived
  // @ts-expect-error - not an Error
  const notError: string = revived
  // @ts-expect-error - cannot box non-Error
  box('not an error', {} as RevivableContext)
}

import type { RevivableContext } from './utils'

import { BoxBase } from './utils'

export const type = 'date' as const

export const isType = (value: unknown): value is Date =>
  value instanceof Date

export const box = <T extends Date, T2 extends RevivableContext>(
  value: T,
  _context: T2
) => ({
  ...BoxBase,
  type,
  ISOString: value.toISOString()
})

export const revive = <T extends ReturnType<typeof box>, T2 extends RevivableContext>(
  value: T,
  _context: T2
): Date => {
  return new Date(value.ISOString)
}

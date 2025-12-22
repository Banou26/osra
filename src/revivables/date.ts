import type { RevivableContext } from './utils'

import { BoxBase } from '.'

export const type = 'date' as const

export const isType = (value: unknown): value is Date =>
  value instanceof Date

export const box = <T extends RevivableContext>(
  value: Date,
  _context: T
) => ({
  ...BoxBase,
  type,
  ISOString: value.toISOString()
})

export const revive = <T extends RevivableContext>(
  value: ReturnType<typeof box>,
  _context: T
): Date => {
  return new Date(value.ISOString)
}

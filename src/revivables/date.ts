import type { RevivableContextBase } from './utils'

import { BoxBase } from '.'

export const type = 'date' as const

export const isType = (value: unknown): value is Date =>
  value instanceof Date

export const box = (
  value: Date,
  _context: RevivableContextBase
) => ({
  ...BoxBase,
  type,
  ISOString: value.toISOString()
})

type DateBox = ReturnType<typeof box>

export const revive = (
  value: DateBox,
  _context: RevivableContextBase
): Date => {
  return new Date(value.ISOString)
}

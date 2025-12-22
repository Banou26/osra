import type { RevivableContext } from './utils'

import { BoxBase } from '.'

export const type = 'error' as const

export const isType = (value: unknown): value is Error =>
  value instanceof Error

export const box = <T extends RevivableContext>(
  value: Error,
  _context: T
) => ({
  ...BoxBase,
  type,
  message: value.message,
  stack: value.stack || value.toString()
})

export const revive = <T extends RevivableContext>(
  value: ReturnType<typeof box>,
  _context: T
) => new Error(value.message, { cause: value.stack })

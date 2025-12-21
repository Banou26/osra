import type { RevivableContextBase } from './utils'

import { BoxBase } from '.'

export const type = 'error' as const

export const isType = (value: unknown): value is Error =>
  value instanceof Error

export const box = (
  value: Error,
  _context: RevivableContextBase
) => ({
  ...BoxBase,
  type,
  message: value.message,
  stack: value.stack || value.toString()
})

type ErrorBox = ReturnType<typeof box>

export const revive = (
  value: ErrorBox,
  _context: RevivableContextBase
) => new Error(value.message, { cause: value.stack })

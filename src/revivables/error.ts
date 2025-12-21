import type { RevivableContext } from './utils'

import { BoxBase } from '.'

export const type = 'error' as const

export const isType = (value: unknown): value is Error =>
  value instanceof Error

export const box = (
  value: Error,
  _context: RevivableContext
) => ({
  ...BoxBase,
  type,
  message: value.message,
  stack: value.stack || value.toString()
})

type ErrorBox = ReturnType<typeof box>

export const revive = (
  value: ErrorBox,
  _context: RevivableContext
) => new Error(value.message, { cause: value.stack })

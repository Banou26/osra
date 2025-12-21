import type { ConnectionRevivableContext } from '../connection'

export const type = 'error' as const

export type Source = Error

export type Boxed = {
  type: typeof type
  message: string
  stack: string
}

export const is = (value: unknown): value is Source =>
  value instanceof Error

export const shouldBox = (_value: Source, _context: ConnectionRevivableContext): boolean =>
  true

export const box = (
  value: Source,
  _context: ConnectionRevivableContext
): Boxed => {
  return {
    type,
    message: value.message,
    stack: value.stack || value.toString()
  }
}

export const revive = (
  value: Boxed,
  _context: ConnectionRevivableContext
): Source => {
  return new Error(value.message, { cause: value.stack })
}

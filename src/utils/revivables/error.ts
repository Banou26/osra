import type { ConnectionRevivableContext } from '../connection'
import { OSRA_BOX } from '../../types'

export const type = 'error' as const

export type Source = Error

export type Boxed = {
  type: typeof type
  message: string
  stack: string
}

export type Box = { [OSRA_BOX]: 'revivable' } & Boxed

export const is = (value: unknown): value is Source =>
  value instanceof Error

export const isBox = (value: unknown): value is Box =>
  value !== null &&
  typeof value === 'object' &&
  OSRA_BOX in value &&
  (value as Record<string, unknown>)[OSRA_BOX] === 'revivable' &&
  (value as Record<string, unknown>).type === type

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

import type {
  RevivableError,
  RevivableVariant
} from '../../types'
import type { ConnectionRevivableContext } from '../connection'

export const type = 'error'

export const is = (value: unknown): value is Error =>
  value instanceof Error

export const shouldBox = (_value: Error, _context: ConnectionRevivableContext): boolean =>
  true

export const box = (
  value: Error,
  _context: ConnectionRevivableContext
): RevivableVariant & { type: 'error' } => {
  return {
    type,
    message: value.message,
    stack: value.stack || value.toString()
  }
}

export const revive = (
  value: RevivableError,
  _context: ConnectionRevivableContext
): Error => {
  return new Error(value.message, { cause: value.stack })
}

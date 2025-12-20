import type {
  RevivableError,
  RevivableVariant
} from '../../types'
import type { ConnectionRevivableContext } from '../connection'

export const name = 'error'

export const is = (value: unknown): value is Error =>
  value instanceof Error

export const box = (
  value: Error,
  _context: ConnectionRevivableContext,
  _recursiveBox?: (value: any, context: ConnectionRevivableContext) => any,
  _recursiveRevive?: (value: any, context: ConnectionRevivableContext) => any
): RevivableVariant & { type: 'error' } => {
  return {
    type: 'error',
    message: value.message,
    stack: value.stack || value.toString()
  }
}

export const revive = (
  value: RevivableError,
  _context: ConnectionRevivableContext,
  _recursiveBox?: (value: any, context: ConnectionRevivableContext) => any,
  _recursiveRevive?: (value: any, context: ConnectionRevivableContext) => any
): Error => {
  return new Error(value.message, { cause: value.stack })
}

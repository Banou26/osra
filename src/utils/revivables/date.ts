import type {
  RevivableDate,
  RevivableVariant
} from '../../types'
import type { ConnectionRevivableContext } from '../connection'

export const name = 'date'

export const is = (value: unknown): value is Date =>
  value instanceof Date

export const box = (
  value: Date,
  _context: ConnectionRevivableContext,
  _recursiveBox?: (value: any, context: ConnectionRevivableContext) => any,
  _recursiveRevive?: (value: any, context: ConnectionRevivableContext) => any
): RevivableVariant & { type: 'date' } => {
  return {
    type: 'date',
    ISOString: value.toISOString()
  }
}

export const revive = (
  value: RevivableDate,
  _context: ConnectionRevivableContext,
  _recursiveBox?: (value: any, context: ConnectionRevivableContext) => any,
  _recursiveRevive?: (value: any, context: ConnectionRevivableContext) => any
): Date => {
  return new Date(value.ISOString)
}

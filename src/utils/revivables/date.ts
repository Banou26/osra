import type {
  RevivableDate,
  RevivableVariant
} from '../../types'
import type { ConnectionRevivableContext } from '../connection'

export const type = 'date'

export const is = (value: unknown): value is Date =>
  value instanceof Date

export const box = (
  value: Date,
  _context: ConnectionRevivableContext
): RevivableVariant & { type: 'date' } => {
  return {
    type,
    ISOString: value.toISOString()
  }
}

export const revive = (
  value: RevivableDate,
  _context: ConnectionRevivableContext
): Date => {
  return new Date(value.ISOString)
}

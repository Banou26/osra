import type { ConnectionRevivableContext } from '../connection'

// Type name as a literal type
export const type = 'date' as const

// Source type - the original value type that this module handles
export type Source = Date

// Boxed type - the serialized form of the value
export type Boxed = {
  type: typeof type
  ISOString: string
}

export const is = (value: unknown): value is Source =>
  value instanceof Date

export const shouldBox = (_value: Source, _context: ConnectionRevivableContext): boolean =>
  true

export const box = (
  value: Source,
  _context: ConnectionRevivableContext
): Boxed => {
  return {
    type,
    ISOString: value.toISOString()
  }
}

export const revive = (
  value: Boxed,
  _context: ConnectionRevivableContext
): Source => {
  return new Date(value.ISOString)
}

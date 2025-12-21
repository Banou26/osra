import type { ConnectionRevivableContext } from '../connection'
import { OSRA_BOX } from '../../types'
import {
  TypedArray,
  TypeArrayType,
  typedArrayToType,
  typedArrayTypeToTypedArrayConstructor,
  isTypedArray
} from '../type-guards'

export const type = 'typedArray' as const

export type Source = TypedArray

export type Boxed = {
  type: typeof type
  typedArrayType: TypeArrayType
  arrayBuffer: ArrayBuffer
}

export type Box = { [OSRA_BOX]: 'revivable' } & Boxed

export const is = (value: unknown): value is Source =>
  isTypedArray(value)

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
    typedArrayType: typedArrayToType(value),
    arrayBuffer: value.buffer
  }
}

export const revive = (
  value: Boxed,
  _context: ConnectionRevivableContext
): Source => {
  const TypedArrayConstructor = typedArrayTypeToTypedArrayConstructor(value.typedArrayType)
  const result = new TypedArrayConstructor(value.arrayBuffer)
  return result
}

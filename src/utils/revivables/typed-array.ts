import type { ConnectionRevivableContext } from '../connection'
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

export const is = (value: unknown): value is Source =>
  isTypedArray(value)

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

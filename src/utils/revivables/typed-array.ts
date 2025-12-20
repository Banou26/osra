import type {
  RevivableTypedArray,
  RevivableVariant
} from '../../types'
import type { ConnectionRevivableContext } from '../connection'
import {
  TypedArray,
  typedArrayToType,
  typedArrayTypeToTypedArrayConstructor,
  isTypedArray
} from '../type-guards'

export const type = 'typedArray'

export const is = (value: unknown): value is TypedArray =>
  isTypedArray(value)

export const shouldBox = (_value: TypedArray, _context: ConnectionRevivableContext): boolean =>
  true

export const box = (
  value: TypedArray,
  _context: ConnectionRevivableContext
): RevivableVariant & { type: 'typedArray' } => {
  return {
    type,
    typedArrayType: typedArrayToType(value),
    arrayBuffer: value.buffer
  }
}

export const revive = (
  value: RevivableTypedArray,
  _context: ConnectionRevivableContext
): TypedArray => {
  const TypedArrayConstructor = typedArrayTypeToTypedArrayConstructor(value.typedArrayType)
  const result = new TypedArrayConstructor(value.arrayBuffer)
  return result
}

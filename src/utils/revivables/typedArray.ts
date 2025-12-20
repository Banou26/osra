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

export const name = 'typedArray'

export const is = (value: unknown): value is TypedArray =>
  isTypedArray(value)

export const box = (
  value: TypedArray,
  _context: ConnectionRevivableContext,
  _recursiveBox?: (value: any, context: ConnectionRevivableContext) => any,
  _recursiveRevive?: (value: any, context: ConnectionRevivableContext) => any
): RevivableVariant & { type: 'typedArray' } => {
  return {
    type: 'typedArray',
    typedArrayType: typedArrayToType(value),
    arrayBuffer: value.buffer
  }
}

export const revive = (
  value: RevivableTypedArray,
  _context: ConnectionRevivableContext,
  _recursiveBox?: (value: any, context: ConnectionRevivableContext) => any,
  _recursiveRevive?: (value: any, context: ConnectionRevivableContext) => any
): TypedArray => {
  const TypedArrayConstructor = typedArrayTypeToTypedArrayConstructor(value.typedArrayType)
  const result = new TypedArrayConstructor(value.arrayBuffer)
  return result
}

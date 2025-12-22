import type { IsJsonOnlyTransport } from '../utils'
import type { RevivableContext } from './utils'

import { BoxBase } from '.'
import { isJsonOnlyTransport } from '../utils'

export const type = 'typedArray' as const

// ============================================================================
// TypedArray Utilities
// ============================================================================

const typedArrayConstructors = [
  Int8Array,
  Uint8Array,
  Uint8ClampedArray,
  Int16Array,
  Uint16Array,
  Int32Array,
  Uint32Array,
  Float16Array,
  Float32Array,
  Float64Array,
  BigInt64Array,
  BigUint64Array
]
export type TypedArrayConstructor = typeof typedArrayConstructors[number]

const typedArrays = [
  new Int8Array(),
  new Uint8Array(),
  new Uint8ClampedArray(),
  new Int16Array(),
  new Uint16Array(),
  new Int32Array(),
  new Uint32Array(),
  new Float16Array(),
  new Float32Array(),
  new Float64Array(),
  new BigInt64Array(),
  new BigUint64Array()
]
export type TypedArray = typeof typedArrays[number]

export const typedArrayToType = <T extends TypedArray>(value: T) => {
  const type =
    value instanceof Int8Array ? 'Int8Array' :
    value instanceof Uint8Array ? 'Uint8Array' :
    value instanceof Uint8ClampedArray ? 'Uint8ClampedArray' :
    value instanceof Int16Array ? 'Int16Array' :
    value instanceof Uint16Array ? 'Uint16Array' :
    value instanceof Int32Array ? 'Int32Array' :
    value instanceof Uint32Array ? 'Uint32Array' :
    value instanceof Float16Array ? 'Float16Array' :
    value instanceof Float32Array ? 'Float32Array' :
    value instanceof Float64Array ? 'Float64Array' :
    value instanceof BigInt64Array ? 'BigInt64Array' :
    value instanceof BigUint64Array ? 'BigUint64Array' :
    undefined
  if (type === undefined) throw new Error('Unknown typed array type')
  return type
}
export type TypedArrayType = ReturnType<typeof typedArrayToType>

export const typedArrayTypeToTypedArrayConstructor = (value: TypedArrayType): TypedArrayConstructor => {
  const typedArray =
    value === 'Int8Array' ? Int8Array :
    value === 'Uint8Array' ? Uint8Array :
    value === 'Uint8ClampedArray' ? Uint8ClampedArray :
    value === 'Int16Array' ? Int16Array :
    value === 'Uint16Array' ? Uint16Array :
    value === 'Int32Array' ? Int32Array :
    value === 'Uint32Array' ? Uint32Array :
    value === 'Float16Array' ? Float16Array :
    value === 'Float32Array' ? Float32Array :
    value === 'Float64Array' ? Float64Array :
    value === 'BigInt64Array' ? BigInt64Array :
    value === 'BigUint64Array' ? BigUint64Array :
    undefined
  if (typedArray === undefined) throw new Error('Unknown typed array type')
  return typedArray
}

// ============================================================================
// Revivable Module
// ============================================================================

export const isType = (value: unknown): value is TypedArray =>
  typedArrayConstructors.some(ctor => value instanceof ctor)

export const box = <T extends RevivableContext>(
  value: TypedArray,
  _context: T
) => ({
  ...BoxBase,
  type,
  typedArrayType: typedArrayToType(value),
  ...(
    isJsonOnlyTransport(_context)
      ? { base64Buffer: new Uint8Array(value.buffer).toBase64() }
      : { arrayBuffer: value.buffer }
  ) as (
      IsJsonOnlyTransport<T['transport']> extends true ? { base64Buffer: string }
    : IsJsonOnlyTransport<T['transport']> extends false ? { arrayBuffer: ArrayBuffer }
    : { base64Buffer: string } | { arrayBuffer: ArrayBuffer }
  )
})

export const revive = <T extends RevivableContext>(
  value: ReturnType<typeof box>,
  _context: T
): TypedArray => {
  const TypedArrayConstructor = typedArrayTypeToTypedArrayConstructor(value.typedArrayType as TypedArrayType)
  const arrayBuffer =
    'arrayBuffer' in value
      ? value.arrayBuffer
      : Uint8Array.fromBase64(value.base64Buffer).buffer
  return new TypedArrayConstructor(arrayBuffer)
}

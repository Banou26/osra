import type { IsJsonOnlyTransport } from '../utils'
import type { RevivableContext, UnderlyingType } from './utils'
import type { TypedArray, TypedArrayType } from '../utils/type-guards'

import { BoxBase } from './utils'
import { isJsonOnlyTransport } from '../utils'
import {
  isTypedArray,
  typedArrayToType,
  typedArrayTypeToTypedArrayConstructor,
} from '../utils/type-guards'

export const type = 'typedArray' as const

export const isType = isTypedArray

export const box = <T extends TypedArray, T2 extends RevivableContext>(
  value: T,
  context: T2
) => ({
  ...BoxBase,
  type,
  typedArrayType: typedArrayToType(value),
  ...(
    isJsonOnlyTransport(context.transport)
      ? { base64Buffer: new Uint8Array(value.buffer).toBase64() }
      : { arrayBuffer: value.buffer }
  ) as (
      IsJsonOnlyTransport<T2['transport']> extends true ? { base64Buffer: string }
    : IsJsonOnlyTransport<T2['transport']> extends false ? { arrayBuffer: ArrayBuffer }
    : { base64Buffer: string } | { arrayBuffer: ArrayBuffer }
  ) & { [UnderlyingType]: T }
})

export const revive = <T extends ReturnType<typeof box>, T2 extends RevivableContext>(
  value: T,
  context: T2
): T[UnderlyingType] => {
  const Ctor = typedArrayTypeToTypedArrayConstructor(value.typedArrayType as TypedArrayType)
  const arrayBuffer =
    'arrayBuffer' in value
      ? value.arrayBuffer
      : Uint8Array.fromBase64(value.base64Buffer).buffer
  return new Ctor(arrayBuffer)
}

const typeCheck = () => {
  const uint8Boxed = box(new Uint8Array(10), {} as RevivableContext)
  const uint8Revived = revive(uint8Boxed, {} as RevivableContext)
  const expectedUint8: Uint8Array = uint8Revived
  // @ts-expect-error - wrong typed array type
  const wrongType: Int32Array = uint8Revived

  const float32Boxed = box(new Float32Array(10), {} as RevivableContext)
  const float32Revived = revive(float32Boxed, {} as RevivableContext)
  const expectedFloat32: Float32Array = float32Revived
  // @ts-expect-error - wrong typed array type
  const wrongFloat: Uint8Array = float32Revived

  // @ts-expect-error - cannot box non-TypedArray
  box('not a typed array', {} as RevivableContext)
}

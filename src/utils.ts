

export type TypedArray = Int8Array | Uint8Array | Uint8ClampedArray | Int16Array | Uint16Array | Int32Array | Uint32Array | Float32Array | Float64Array | BigInt64Array | BigUint64Array

export type TransferableObject = ArrayBuffer | MessagePort | ReadableStream | WritableStream | TransformStream | /* AudioData | */ ImageBitmap /* | VideoFrame | OffscreenCanvas */

const typedArrays = [Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array, Float32Array, Float64Array, BigInt64Array, BigUint64Array]

const isTransferable = (value: any) =>
  value instanceof ArrayBuffer ? true :
  value instanceof MessagePort ? true :
  value instanceof ReadableStream ? true :
  value instanceof WritableStream ? true :
  value instanceof TransformStream ? true :
  value instanceof ImageBitmap ? true :
  typedArrays.some(type => value instanceof type) ? true :
  false

export const getTransferableObjects = (value: any): TransferableObject[] => {
  const transferables: TransferableObject[] = []
  const recurse = (value: any) => 
    isTransferable(value) ? transferables.push(value) :
    Array.isArray(value) ? value.map(recurse) :
    value && typeof value === 'object' ? Object.values(value).map(recurse) :
    undefined

  recurse(value)
  return transferables
}

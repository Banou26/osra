import { TransferableObject } from './types'

const isTransferable = (value: any) =>
  value instanceof ArrayBuffer ? true :
  value instanceof MessagePort ? true :
  value instanceof ReadableStream ? true :
  value instanceof WritableStream ? true :
  value instanceof TransformStream ? true :
  value instanceof ImageBitmap ? true :
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

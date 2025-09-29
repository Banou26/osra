import type { TransferBox } from '../types'

import { OSRA_BOX } from '../types'
import { isClonable, isTransferable, isTransferBox } from './type-guards'

export const getTransferableObjects = (value: any): Transferable[] => {
  const transferables: Transferable[] = []
  const recurse = (value: any): any =>
      isClonable(value) ? undefined
    : isTransferable(value) ? transferables.push(value)
    : Array.isArray(value) ? value.map(recurse)
    : value && typeof value === 'object' ? Object.values(value).map(recurse)
    : undefined

  recurse(value)
  return transferables
}

export const getTransferBoxes = (value: any): TransferBox<Transferable>[] => {
  const transferBoxes: TransferBox<any>[] = []
  const recurse = (value: any): any =>
      isTransferBox(value) ? transferBoxes.push(value)
    : Array.isArray(value) ? value.map(recurse)
    : value && typeof value === 'object' ? Object.values(value).map(recurse)
    : undefined

  recurse(value)
  return transferBoxes
}

/** This box tells the protocol that the value should be copied instead of transfered */
export const transfer = <T extends Transferable>(value: T) => ({
  [OSRA_BOX]: 'transfer',
  value
}) as TransferBox<T>

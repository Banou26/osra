import type { Capable, Jsonable, Revivable, RevivableVariant, RevivableVariantType, ReviveBox, TransferBox } from '../types'

import { OSRA_BOX } from '../types'
import { replaceRecursive } from './replace'
import { isClonable, isRevivable, isTransferable, isTransferBox, revivableToType } from './type-guards'

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
  [OSRA_BOX]: 'transferable',
  value
}) as TransferBox<T>

export const boxAllTransferables = <T extends Capable>(value: T) =>
  replaceRecursive(
    value,
    (value: any) =>
      isTransferable(value)
        ? transfer(value)
        : value
  )

export const boxAllRevivables = <T extends Capable>(value: T, func: (value: Revivable) => RevivableVariant) =>
  replaceRecursive(
    value,
    (value: any) =>
      isRevivable(value)
        ? boxRevivable(value, func)
        : value
  )

export const boxRevivable = (value: Revivable, func: (value: Revivable) => RevivableVariant) => {
  const trap = (hint?: 'number' | 'string' | 'default') => {
    const box = {
      [OSRA_BOX]: 'revivable',
      ...func(value)
    } satisfies ReviveBox

    return (
      hint === 'string'
        ? JSON.stringify(box)
        : box
    )
  }
  return {
    [OSRA_BOX]: 'revivable',
    type: revivableToType(value),
    value,
    [Symbol.toPrimitive]: trap,
    valueOf: trap,
    toString: trap,
    toJSON: () => trap('string')
  }
}

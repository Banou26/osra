import type { Capable, Revivable, RevivableBox, RevivableVariant, TransferBox } from '../types'

import { OSRA_BOX } from '../types'
import { ConnectionRevivableContext } from './connection'
import { replaceRecursive } from './replace'
import { box, boxAllTypes, boxMessagePort, revive } from './revivable'
import {
  isClonable, isMessagePort, isRevivable,
  isRevivableBox,
  isTransferable, isTransferBox, revivableToType
} from './type-guards'

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

export const serializeTrapBox = (value: Revivable, func: (value: Revivable) => RevivableVariant) => {
  const trap = (hint?: 'number' | 'string' | 'default') => {
    const box = {
      [OSRA_BOX]: 'revivable',
      ...func(value)
    } satisfies RevivableBox

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

export const recursiveBox = <T extends Capable>(value: T, func: (value: Revivable) => RevivableVariant) =>
  replaceRecursive(
    value,
    (value) =>
      isRevivable(value)
        ? serializeTrapBox(value, func)
        : value
  )

export const recursiveRevive = <T extends Capable>(value: T, context: ConnectionRevivableContext) =>
  replaceRecursive(
    value,
    (value) =>
      isRevivableBox(value)
        ? revive(context)(value)
        : value,
    true
  )

export const boxMessage = (value: Capable, context: ConnectionRevivableContext) =>
  recursiveBox(
    value,
    box(context)
  )

export const reviveMessage = (value: Capable, context: ConnectionRevivableContext) =>
  recursiveRevive(
    value,
    context
  )

import type { Revivable, RevivableBox, RevivableVariant, RevivableVariantType } from '../../types'
import type { ConnectionRevivableContext } from '../connection'

import * as messagePort from './message-port'
import * as promise from './promise'
import * as func from './function'
import * as typedArray from './typed-array'
import * as arrayBuffer from './array-buffer'
import * as error from './error'
import * as readableStream from './readable-stream'
import * as date from './date'

export type RevivableModule = {
  type: string
  is: (value: unknown) => boolean
  box: (value: any, context: ConnectionRevivableContext) => RevivableVariant
  revive: (value: any, context: ConnectionRevivableContext) => any
}

export type RevivablesRegistry = Record<string, RevivableModule>

// Default revivables that ship with osra
export const defaultRevivables: RevivablesRegistry = {
  messagePort,
  promise,
  function: func,
  typedArray,
  arrayBuffer,
  error,
  readableStream,
  date
}

// Find the revivable module that can handle a given value
export const findRevivableForValue = (
  value: unknown,
  revivables: RevivablesRegistry
): RevivableModule | undefined =>
  Object.values(revivables).find(revivable => revivable.is(value))

// Find the revivable module by type name
export const findRevivableByType = (
  type: RevivableVariantType,
  revivables: RevivablesRegistry
): RevivableModule | undefined =>
  revivables[type]

// Box a revivable value using the appropriate module
export const boxValue = (
  value: Revivable,
  context: ConnectionRevivableContext
): RevivableVariant | undefined => {
  const module = findRevivableForValue(value, context.revivables)
  if (!module) return undefined
  return module.box(value, context)
}

// Revive a boxed value using the appropriate module
export const reviveValue = (
  box: RevivableBox,
  context: ConnectionRevivableContext
): Revivable | undefined => {
  const module = findRevivableByType(box.type, context.revivables)
  if (!module) return undefined
  return module.revive(box, context)
}

import type { Revivable, RevivableBox, RevivableVariant, RevivableVariantType } from '../../types'
import type { ConnectionRevivableContext } from '../connection'

import * as messagePort from './messagePort'
import * as promise from './promise'
import * as func from './function'
import * as typedArray from './typedArray'
import * as arrayBuffer from './arrayBuffer'
import * as error from './error'
import * as readableStream from './readableStream'
import * as date from './date'

export type RevivableModule = {
  name: RevivableVariantType
  is: (value: unknown) => boolean
  box: (value: any, context: ConnectionRevivableContext) => RevivableVariant
  revive: (value: any, context: ConnectionRevivableContext) => any
}

// Registry of all revivable modules
export const revivables = {
  messagePort,
  promise,
  function: func,
  typedArray,
  arrayBuffer,
  error,
  readableStream,
  date
} as const

export type RevivablesRegistry = typeof revivables

// Array of revivables for iteration
export const revivablesList: RevivableModule[] = Object.values(revivables) as RevivableModule[]

// Find the revivable module that can handle a given value
export const findRevivableForValue = (value: unknown): RevivableModule | undefined =>
  revivablesList.find(revivable => revivable.is(value))

// Find the revivable module by type name
export const findRevivableByType = (type: RevivableVariantType): RevivableModule | undefined =>
  revivables[type as keyof RevivablesRegistry] as RevivableModule | undefined

// Box a revivable value using the appropriate module
export const boxValue = (
  value: Revivable,
  context: ConnectionRevivableContext
): RevivableVariant | undefined => {
  const module = findRevivableForValue(value)
  if (!module) return undefined
  return module.box(value, context)
}

// Revive a boxed value using the appropriate module
export const reviveValue = (
  box: RevivableBox,
  context: ConnectionRevivableContext
): Revivable | undefined => {
  const module = findRevivableByType(box.type)
  if (!module) return undefined
  return module.revive(box, context)
}

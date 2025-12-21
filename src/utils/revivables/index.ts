import type {
  Capable,
  Revivable,
  RevivableBox,
  RevivableToRevivableType,
  RevivableVariant,
  RevivableVariantType,
  ReviveBoxBase
} from '../../types'
import type { ConnectionRevivableContext } from '../connection'
import type { DeepReplace } from '../replace'

import { OSRA_BOX } from '../../types'
import {
  isArrayBuffer,
  isMessagePort,
  isReadableStream,
  isRevivable,
  isRevivableBox,
  isTransferable
} from '../type-guards'

import * as messagePort from './message-port'
import * as promise from './promise'
import * as func from './function'
import * as typedArray from './typed-array'
import * as arrayBuffer from './array-buffer'
import * as error from './error'
import * as readableStream from './readable-stream'
import * as date from './date'

export type RevivableModuleType = {
  type: string
  is: (value: unknown) => value is Revivable
  shouldBox: (value: Revivable, context: ConnectionRevivableContext) => boolean
  box: (value: Revivable, context: ConnectionRevivableContext) => RevivableBox
  revive: (value: RevivableBox, context: ConnectionRevivableContext) => Revivable
}

export const defaultRevivables = [
  messagePort,
  promise,
  func,
  typedArray,
  arrayBuffer,
  error,
  readableStream,
  date
] satisfies RevivableModuleType[]

export type RevivableModule = typeof defaultRevivables[number]
export type RevivablesRegistry = RevivableModule[]

// Base interface for calling module methods through the registry
// Uses generics to preserve type information when the specific module type is known
export interface RevivableModuleBase<
  TValue = unknown,
  TBoxed extends RevivableVariant = RevivableVariant
> {
  type: string
  is: (value: unknown) => value is TValue
  shouldBox: (value: TValue, context: ConnectionRevivableContext) => boolean
  box: (value: TValue, context: ConnectionRevivableContext) => TBoxed
  revive: (value: TBoxed, context: ConnectionRevivableContext) => TValue
}

// Find the revivable module that can handle a given value
// Returns a generic base interface that allows calling methods with the matched value type
export function findRevivableForValue<T>(
  value: T,
  revivables: RevivablesRegistry
): RevivableModuleBase<T> | undefined {
  const found = revivables.find(revivable => revivable.is(value))
  return found as RevivableModuleBase<T> | undefined
}

// Find the revivable module by type name
export function findRevivableByType(
  type: RevivableVariantType,
  revivables: RevivablesRegistry
): RevivableModuleBase | undefined {
  const found = revivables.find(revivable => revivable.type === type)
  return found as RevivableModuleBase | undefined
}

// Determine if a value should be boxed based on its type and context
export const shouldBox = (value: unknown, context: ConnectionRevivableContext): boolean => {
  const module = findRevivableForValue(value, context.revivables)
  if (!module) return false
  return module.shouldBox(value, context)
}

export const box = (value: Revivable, context: ConnectionRevivableContext) => {
  if (shouldBox(value, context)) {
    const module = findRevivableForValue(value, context.revivables)
    if (module) {
      return {
        [OSRA_BOX]: 'revivable',
        ...module.box(value, context)
      } as RevivableBox
    }
  }

  // For capable transports (or unknown types on JSON transport), just mark the type but pass through the value
  return {
    [OSRA_BOX]: 'revivable',
    ...'isJson' in context.transport && context.transport.isJson
      ? { type: 'unknown' as const, value }
      : {
        type:
          isMessagePort(value) ? 'messagePort' as const
          : isArrayBuffer(value) ? 'arrayBuffer' as const
          : isReadableStream(value) ? 'readableStream' as const
          : 'unknown' as const,
        value
      }
  } as ReviveBoxBase<RevivableToRevivableType<typeof value>>
}

export const recursiveBox = <T extends Capable>(value: T, context: ConnectionRevivableContext): DeepReplace<T, Revivable, RevivableBox> => {
  const boxedValue = isRevivable(value) ? box(value, context) : value
  return (
    Array.isArray(boxedValue) ? boxedValue.map(value => recursiveBox(value, context)) as DeepReplace<T, Revivable, RevivableBox>
    : boxedValue && typeof boxedValue === 'object' && Object.getPrototypeOf(boxedValue) === Object.prototype ? (
      Object.fromEntries(
        Object
          .entries(boxedValue)
          .map(([key, value]: [string, Capable]) => [
            key,
            isRevivableBox(boxedValue) && boxedValue.type === 'messagePort' && boxedValue.value instanceof MessagePort
            || isRevivableBox(boxedValue) && boxedValue.type === 'arrayBuffer' && boxedValue.value instanceof ArrayBuffer
            || isRevivableBox(boxedValue) && boxedValue.type === 'readableStream' && boxedValue.value instanceof ReadableStream
              ? value
              : recursiveBox(value, context)
          ])
      )
    ) as DeepReplace<T, Revivable, RevivableBox>
    : boxedValue as DeepReplace<T, Revivable, RevivableBox>
  )
}

export const revive = (box: RevivableBox, context: ConnectionRevivableContext) => {
  // If the value got properly sent through the protocol as is, we don't need to revive it
  if (isRevivable(box.value)) return box.value

  // Use dynamic lookup to find the appropriate reviver
  const module = findRevivableByType(box.type, context.revivables)
  if (module) {
    return module.revive(box, context)
  }

  return box as DeepReplace<RevivableBox, RevivableBox, Revivable>
}

export const recursiveRevive = <T extends Capable>(value: T, context: ConnectionRevivableContext): DeepReplace<T, RevivableBox, Revivable> => {
  const recursedValue = (
    isTransferable(value) ? value
    : Array.isArray(value) ? value.map(value => recursiveRevive(value, context)) as DeepReplace<T, RevivableBox, Revivable>
    : value && typeof value === 'object' ? (
      Object.fromEntries(
        Object
          .entries(value)
          .map(([key, value]: [string, Capable]) => [
            key,
            recursiveRevive(value, context)
          ])
      )
    ) as DeepReplace<T, RevivableBox, Revivable>
    : value as DeepReplace<T, RevivableBox, Revivable>
  )
  return (isRevivableBox(recursedValue) ? revive(recursedValue, context) : recursedValue) as DeepReplace<T, RevivableBox, Revivable>
}

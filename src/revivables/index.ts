import type { BoxBase, RevivableContext } from './utils'
export type { UnderlyingType } from './utils'
import type { DeepReplaceWithBox, DeepReplaceWithRevive, ReplaceWithBox, ReplaceWithRevive } from '../utils/replace'

import { Capable } from '../types'
import { isRevivableBox } from './utils'
import * as arrayBuffer from './array-buffer'
import * as context from './context'
import * as date from './date'
import * as headers from './headers'
import * as error from './error'
import * as typedArray from './typed-array'
import * as promise from './promise'
import * as func from './function'
import * as messagePort from './message-port'
import * as readableStream from './readable-stream'

export type RevivableModule<T extends string = string, T2 = any, T3 extends BoxBase<T> = any> = {
  readonly type: T
  readonly isType: (value: unknown) => value is T2
  readonly box: ((value: T2, context: RevivableContext) => T3) | ((...args: any[]) => any)
  readonly revive: (value: T3, context: RevivableContext) => T2
}

export const defaultRevivableModules = [
  arrayBuffer,
  context,
  date,
  headers,
  error,
  typedArray,
  promise,
  func,
  messagePort,
  readableStream
] as const

export type DefaultRevivableModules = typeof defaultRevivableModules

export type DefaultRevivableModule = DefaultRevivableModules[number]

export const findModuleForValue = <T extends Capable, T2 extends RevivableContext>(
  value: T,
  context: T2
): ReplaceWithBox<T, T2['revivableModules'][number]> => {
  type ReturnCastType = ReplaceWithBox<T, T2['revivableModules'][number]>
  const handledByModule = context.revivableModules.find(module => module.isType(value))
  if (handledByModule?.isType(value)) {
    return (handledByModule.box as (v: unknown, c: RevivableContext) => unknown)(value, context) as ReturnCastType
  }
  return value as ReturnCastType
}

export const box = <T extends Capable, T2 extends RevivableContext>(
  value: T,
  context: T2
): ReplaceWithBox<T, T2['revivableModules'][number]> => {
  type ReturnCastType = ReplaceWithBox<T, T2['revivableModules'][number]>
  const handledByModule = context.revivableModules.find(module => module.isType(value))
  if (handledByModule?.isType(value)) {
    return (handledByModule.box as (v: unknown, c: RevivableContext) => unknown)(value, context) as ReturnCastType
  }
  return value as ReturnCastType
}

export const recursiveBox = <T extends Capable, T2 extends RevivableContext>(
  value: T,
  context: T2
): DeepReplaceWithBox<T, T2['revivableModules'][number]> => {
  type ReturnCastType = DeepReplaceWithBox<T, T2['revivableModules'][number]>

  const handledByModule = context.revivableModules.find(module => module.isType(value))
  if (handledByModule?.isType(value)) {
    return (handledByModule.box as (v: unknown, c: RevivableContext) => unknown)(value, context) as ReturnCastType
  }

  return (
    Array.isArray(value) ? value.map(value => recursiveBox(value, context)) as ReturnCastType
    : value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype ? (
      Object.fromEntries(
        Object
          .entries(value)
          .map(([key, value]: [string, Capable]) => [
            key,
            recursiveBox(value, context)
          ])
      )
    ) as ReturnCastType
    : value as ReturnCastType
  )
}

export const revive = <T extends ReturnType<typeof box>, T2 extends RevivableContext>(
  value: T,
  context: T2
): ReplaceWithRevive<T, T2['revivableModules'][number]> => {
  type ReturnCastType = ReplaceWithRevive<T, T2['revivableModules'][number]>
  const boxType =
    isRevivableBox(value, context)
      ? value.type
      : undefined
  const handledByModule = context.revivableModules.find(module => module.type === boxType)
  if (handledByModule) {
    return (handledByModule.revive as (v: unknown, c: RevivableContext) => unknown)(value, context) as ReturnCastType
  }
  return value as ReturnCastType
}

export const recursiveRevive = <T extends Capable, T2 extends RevivableContext>(
  value: T,
  context: T2
): DeepReplaceWithRevive<T, T2['revivableModules'][number]> => {
  type ReturnCastType = DeepReplaceWithRevive<T, T2['revivableModules'][number]>

  // First check if the value is a revivable box and revive it
  if (isRevivableBox(value, context)) {
    const handledByModule = context.revivableModules.find(module => module.type === value.type)
    if (handledByModule) {
      return (handledByModule.revive as (v: unknown, c: RevivableContext) => unknown)(value, context) as ReturnCastType
    }
  }

  // Then recurse into arrays and plain objects
  return (
    Array.isArray(value) ? value.map(value => recursiveRevive(value, context)) as ReturnCastType
    : value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype ? (
      Object.fromEntries(
        Object
          .entries(value)
          .map(([key, value]: [string, Capable]) => [
            key,
            recursiveRevive(value, context)
          ])
      )
    ) as ReturnCastType
    : value as ReturnCastType
  )
}

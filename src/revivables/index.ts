import type { BoxBase, RevivableContext } from './utils'
export type { UnderlyingType } from './utils'
import type { DeepReplaceWithBox, DeepReplaceWithRevive, ReplaceWithBox, ReplaceWithRevive } from '../utils/replace'

import { Capable } from '../types'
import { isRevivableBox } from './utils'
import * as arrayBuffer from './array-buffer'
import * as date from './date'
import * as headers from './headers'
import * as error from './error'
import * as typedArray from './typed-array'
import * as promise from './promise'
import * as func from './function'
import * as messagePort from './message-port'
import * as readableStream from './readable-stream'
import * as abortSignal from './abort-signal'
import * as response from './response'
import * as request from './request'
import * as identity from './identity'
import * as transfer from './transfer'

export { identity } from './identity'
export { transfer } from './transfer'

export * from './utils'

export type RevivableModule<T extends string = string, T2 = any, T3 extends BoxBase<T> = any> = {
  readonly type: T
  readonly isType: (value: unknown) => value is T2
  readonly box: ((value: T2, context: RevivableContext) => T3) | ((...args: any[]) => any)
  readonly revive: (value: T3, context: RevivableContext) => T2
}

export const defaultRevivableModules = [
  transfer,
  identity,
  arrayBuffer,
  date,
  headers,
  error,
  typedArray,
  promise,
  func,
  messagePort,
  readableStream,
  abortSignal,
  response,
  request
] as const

export type DefaultRevivableModules = typeof defaultRevivableModules

export type DefaultRevivableModule = DefaultRevivableModules[number]

const tryBoxWithModule = <T2 extends RevivableContext<readonly RevivableModule[]>>(
  value: unknown,
  context: T2
): { boxed: true, value: unknown } | { boxed: false } => {
  const handledByModule = context.revivableModules.find(module => module.isType(value))
  if (handledByModule?.isType(value)) {
    const boxFn = handledByModule.box as (v: unknown, c: RevivableContext<readonly RevivableModule[]>) => unknown
    return { boxed: true, value: boxFn(value, context) }
  }
  return { boxed: false }
}

export const box = <
  T extends Capable,
  T2 extends RevivableContext<readonly RevivableModule[]>
>(
  value: T,
  context: T2
): ReplaceWithBox<T, T2['revivableModules'][number]> => {
  type ReturnCastType = ReplaceWithBox<T, T2['revivableModules'][number]>
  const result = tryBoxWithModule(value, context)
  return (result.boxed ? result.value : value) as ReturnCastType
}

/** @deprecated Use `box` instead. Kept as an alias for backwards compatibility. */
export const findModuleForValue = box

export const recursiveBox = <
  T extends Capable,
  T2 extends RevivableContext<readonly RevivableModule[]>
>(
  value: T,
  context: T2
): DeepReplaceWithBox<T, T2['revivableModules'][number]> => {
  type ReturnCastType = DeepReplaceWithBox<T, T2['revivableModules'][number]>

  const result = tryBoxWithModule(value, context)
  if (result.boxed) return result.value as ReturnCastType

  return (
    Array.isArray(value) ? value.map(item => recursiveBox(item, context)) as ReturnCastType
    : value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype ? (
      Object.fromEntries(
        Object
          .entries(value)
          .map(([key, item]: [string, Capable]) => [key, recursiveBox(item, context)])
      )
    ) as ReturnCastType
    : value as ReturnCastType
  )
}

const tryReviveWithModule = <T2 extends RevivableContext<readonly RevivableModule[]>>(
  value: unknown,
  context: T2
): { revived: true, value: unknown } | { revived: false } => {
  if (!isRevivableBox(value, context)) return { revived: false }
  const handledByModule = context.revivableModules.find(module => module.type === value.type)
  if (!handledByModule) return { revived: false }
  const reviveFn = handledByModule.revive as (v: unknown, c: RevivableContext<readonly RevivableModule[]>) => unknown
  return { revived: true, value: reviveFn(value, context) }
}

export const revive = <
  T extends ReturnType<typeof box>,
  T2 extends RevivableContext<readonly RevivableModule[]>
>(
  value: T,
  context: T2
): ReplaceWithRevive<T, T2['revivableModules'][number]> => {
  type ReturnCastType = ReplaceWithRevive<T, T2['revivableModules'][number]>
  const result = tryReviveWithModule(value, context)
  return (result.revived ? result.value : value) as ReturnCastType
}

export const recursiveRevive = <
  T extends Capable,
  T2 extends RevivableContext<readonly RevivableModule[]>
>(
  value: T,
  context: T2
): DeepReplaceWithRevive<T, T2['revivableModules'][number]> => {
  type ReturnCastType = DeepReplaceWithRevive<T, T2['revivableModules'][number]>

  const result = tryReviveWithModule(value, context)
  if (result.revived) return result.value as ReturnCastType

  return (
    Array.isArray(value) ? value.map(item => recursiveRevive(item, context)) as ReturnCastType
    : value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype ? (
      Object.fromEntries(
        Object
          .entries(value)
          .map(([key, item]: [string, Capable]) => [key, recursiveRevive(item, context)])
      )
    ) as ReturnCastType
    : value as ReturnCastType
  )
}

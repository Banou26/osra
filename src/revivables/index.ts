import type { BoxBase, RevivableContext } from './utils'
export type { UnderlyingType } from './utils'
import type { DeepReplaceWithBox, DeepReplaceWithRevive, ReplaceWithBox, ReplaceWithRevive } from '../utils/replace'
import type { MessageFields } from '../types'

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

export type RevivableModule<T extends string = string, T2 = any, T3 extends BoxBase<T> = any, T4 extends MessageFields = MessageFields> = {
  readonly type: T
  readonly isType: (value: unknown) => value is T2
  readonly box: ((value: T2, context: RevivableContext<any>) => T3) | ((...args: any[]) => any)
  readonly revive: (value: T3, context: RevivableContext<any>) => T2
  readonly init?: (context: RevivableContext<any>) => void
  readonly Messages?: T4
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

export const findModuleForValue = <
  T extends Capable,
  TModules extends readonly RevivableModule[]
>(
  value: T,
  context: RevivableContext<TModules>
): ReplaceWithBox<T, TModules[number]> => {
  type ReturnCastType = ReplaceWithBox<T, TModules[number]>
  const handledByModule = context.revivableModules.find((module: RevivableModule) => module.isType(value))
  if (handledByModule?.isType(value)) {
    return (handledByModule.box as (v: unknown, c: RevivableContext<any>) => unknown)(value, context) as ReturnCastType
  }
  return value as ReturnCastType
}

export const box = <
  T extends Capable,
  TModules extends readonly RevivableModule[]
>(
  value: T,
  context: RevivableContext<TModules>
): ReplaceWithBox<T, TModules[number]> => {
  type ReturnCastType = ReplaceWithBox<T, TModules[number]>
  const handledByModule = context.revivableModules.find((module: RevivableModule) => module.isType(value))
  if (handledByModule?.isType(value)) {
    return (handledByModule.box as (v: unknown, c: RevivableContext<any>) => unknown)(value, context) as ReturnCastType
  }
  return value as ReturnCastType
}

export const recursiveBox = <
  T extends Capable,
  TModules extends readonly RevivableModule[]
>(
  value: T,
  context: RevivableContext<TModules>
): DeepReplaceWithBox<T, TModules[number]> => {
  type ReturnCastType = DeepReplaceWithBox<T, TModules[number]>

  const handledByModule = context.revivableModules.find((module: RevivableModule) => module.isType(value))
  if (handledByModule?.isType(value)) {
    return (handledByModule.box as (v: unknown, c: RevivableContext<any>) => unknown)(value, context) as ReturnCastType
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

export const revive = <
  T extends ReturnType<typeof box>,
  TModules extends readonly RevivableModule[]
>(
  value: T,
  context: RevivableContext<TModules>
): ReplaceWithRevive<T, TModules[number]> => {
  type ReturnCastType = ReplaceWithRevive<T, TModules[number]>
  const boxType =
    isRevivableBox(value, context)
      ? (value as { type: string }).type
      : undefined
  const handledByModule = context.revivableModules.find((module: RevivableModule) => module.type === boxType)
  if (handledByModule) {
    return (handledByModule.revive as (v: unknown, c: RevivableContext<any>) => unknown)(value, context) as ReturnCastType
  }
  return value as ReturnCastType
}

export const recursiveRevive = <
  T extends Capable,
  TModules extends readonly RevivableModule[]
>(
  value: T,
  context: RevivableContext<TModules>
): DeepReplaceWithRevive<T, TModules[number]> => {
  type ReturnCastType = DeepReplaceWithRevive<T, TModules[number]>

  // First check if the value is a revivable box and revive it
  if (isRevivableBox(value, context)) {
    const boxed = value as { type: string }
    const handledByModule = context.revivableModules.find((module: RevivableModule) => module.type === boxed.type)
    if (handledByModule) {
      return (handledByModule.revive as (v: unknown, c: RevivableContext<any>) => unknown)(value, context) as ReturnCastType
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

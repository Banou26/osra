import type { BoxBase, RevivableContext } from './utils'
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

const findBoxModule = (
  value: unknown,
  modules: readonly RevivableModule[]
): RevivableModule | undefined =>
  modules.find(module => module.isType(value))

const findReviveModule = (
  value: unknown,
  modules: readonly RevivableModule[]
): RevivableModule | undefined => {
  if (!value || typeof value !== 'object') return undefined
  const boxType = (value as { type?: unknown }).type
  if (typeof boxType !== 'string') return undefined
  return modules.find(module => module.type === boxType)
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype

export const box = <
  T extends Capable,
  TModules extends readonly RevivableModule[]
>(
  value: T,
  context: RevivableContext<TModules>
): ReplaceWithBox<T, TModules[number]> => {
  const handledByModule = findBoxModule(value, context.revivableModules)
  if (handledByModule) {
    return handledByModule.box(value, context) as ReplaceWithBox<T, TModules[number]>
  }
  return value as ReplaceWithBox<T, TModules[number]>
}

export const recursiveBox = <
  T extends Capable,
  TModules extends readonly RevivableModule[]
>(
  value: T,
  context: RevivableContext<TModules>
): DeepReplaceWithBox<T, TModules[number]> => {
  type ReturnCastType = DeepReplaceWithBox<T, TModules[number]>

  const handledByModule = findBoxModule(value, context.revivableModules)
  if (handledByModule) {
    return handledByModule.box(value, context) as ReturnCastType
  }

  if (Array.isArray(value)) {
    return value.map(v => recursiveBox(v, context)) as ReturnCastType
  }
  if (isPlainObject(value)) {
    return Object.fromEntries(
      (Object.entries(value) as [string, Capable][])
        .map(([key, v]) => [key, recursiveBox(v, context)])
    ) as ReturnCastType
  }
  return value as ReturnCastType
}

export const revive = <
  T extends ReturnType<typeof box>,
  TModules extends readonly RevivableModule[]
>(
  value: T,
  context: RevivableContext<TModules>
): ReplaceWithRevive<T, TModules[number]> => {
  if (!isRevivableBox(value, context)) return value as ReplaceWithRevive<T, TModules[number]>
  const handledByModule = findReviveModule(value, context.revivableModules)
  if (handledByModule) {
    return handledByModule.revive(value, context) as ReplaceWithRevive<T, TModules[number]>
  }
  return value as ReplaceWithRevive<T, TModules[number]>
}

export const recursiveRevive = <
  T extends Capable,
  TModules extends readonly RevivableModule[]
>(
  value: T,
  context: RevivableContext<TModules>
): DeepReplaceWithRevive<T, TModules[number]> => {
  type ReturnCastType = DeepReplaceWithRevive<T, TModules[number]>

  if (isRevivableBox(value, context)) {
    const handledByModule = findReviveModule(value, context.revivableModules)
    if (handledByModule) {
      return handledByModule.revive(value, context) as ReturnCastType
    }
  }

  if (Array.isArray(value)) {
    return value.map(v => recursiveRevive(v, context)) as ReturnCastType
  }
  if (isPlainObject(value)) {
    return Object.fromEntries(
      (Object.entries(value) as [string, Capable][])
        .map(([key, v]) => [key, recursiveRevive(v, context)])
    ) as ReturnCastType
  }
  return value as ReturnCastType
}
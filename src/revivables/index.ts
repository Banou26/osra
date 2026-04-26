import type { BoxBase, RevivableContext } from './utils'
import type { DeepReplaceWithBox, DeepReplaceWithRevive, ReplaceWithBox, ReplaceWithRevive } from '../utils/replace'
import type { MessageFields, Capable } from '../types'

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
import * as map from './map'
import * as set from './set'
import * as bigInt from './bigint'
import * as event from './event'
import * as eventTarget from './event-target'
import { clonable, transferable, unclonable } from './fallbacks'

export { identity } from './identity'
export { transfer } from './transfer'

export * from './utils'

// `any` on box/revive/init: each module's concrete box has a narrower input
// than the shared interface can express, and TS treats readonly function
// types contravariantly. The bivariance escape hatch lets modules assign.
export type RevivableModule<
  T extends string = string,
  T2 = any,
  T3 extends BoxBase<T> = any,
  T4 extends MessageFields = MessageFields,
> = {
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
  request,
  map,
  set,
  bigInt,
  event,
  // eventTarget MUST be last among instanceof-EventTarget revivables —
  // MessagePort/AbortSignal/Window/Worker all extend EventTarget; the
  // specific ones need first dibs via findBoxModule iteration order.
  eventTarget,
  // Pass-through fast paths for wire-safe types — short-circuit findBoxModule
  // before unclonable's structuredClone probe runs on a known-safe value.
  clonable,
  transferable,
  // Catch-all: structuredClone-probes and coerces unclonables to `{}`,
  // matching JSON.stringify(new WeakMap()) === "{}".
  unclonable,
] as const

export type DefaultRevivableModules = typeof defaultRevivableModules
export type DefaultRevivableModule = DefaultRevivableModules[number]

const findBoxModule = (
  value: unknown,
  modules: readonly RevivableModule[]
): RevivableModule | undefined =>
  modules.find(module => module.isType(value))

const findReviveModule = (
  value: BoxBase,
  modules: readonly RevivableModule[],
): RevivableModule | undefined =>
  modules.find(module => module.type === value.type)

const isPlainObject = (value: unknown): value is Record<string, Capable> =>
  !!value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype

const descend = <TOut>(value: unknown, transform: (v: Capable) => unknown): TOut => {
  if (Array.isArray(value)) {
    return value.map(v => transform(v)) as TOut
  }
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries<Capable>(value).map(([k, v]) => [k, transform(v)]),
    ) as TOut
  }
  return value as TOut
}

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
  // Already-boxed values pass through — revivables may embed a pre-built
  // BoxedX in their outgoing payload; descending would re-box raw ports.
  if (isRevivableBox(value)) return value as ReturnCastType
  const handledByModule = findBoxModule(value, context.revivableModules)
  if (handledByModule) {
    return handledByModule.box(value, context) as ReturnCastType
  }
  return descend<ReturnCastType>(value, v => recursiveBox(v, context))
}

export const revive = <
  T extends ReturnType<typeof box>,
  TModules extends readonly RevivableModule[]
>(
  value: T,
  context: RevivableContext<TModules>
): ReplaceWithRevive<T, TModules[number]> => {
  if (!isRevivableBox(value)) return value as ReplaceWithRevive<T, TModules[number]>
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
  if (isRevivableBox(value)) {
    const handledByModule = findReviveModule(value, context.revivableModules)
    if (handledByModule) {
      return handledByModule.revive(value, context) as ReturnCastType
    }
  }
  return descend<ReturnCastType>(value, v => recursiveRevive(v, context))
}
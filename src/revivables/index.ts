import type { ExtractBoxInput, ExtractReviveInput, RevivableContext } from './utils'
import type { DeepReplaceWithBox, DeepReplaceWithRevive, ReplaceWithBox, ReplaceWithRevive } from '../utils/replace'

import { Capable, OSRA_BOX } from '../types'
import { isRevivableBox } from './utils'
import * as arrayBuffer from './array-buffer'
import * as date from './date'
import * as error from './error'

export const BoxBase = {
  [OSRA_BOX]: 'revivable',
  type: '' as string
} as const

export type BoxBase = typeof BoxBase

export type RevivableModule = {
  type: string
  isType: (value: any) => value is any
  box: (value: any, context: RevivableContext) => BoxBase
  revive: (value: any, context: RevivableContext) => any
}

export const defaultRevivableModules = [
  arrayBuffer,
  date,
  error
] satisfies RevivableModule[]

export type DefaultRevivableModules = [
  typeof arrayBuffer,
  typeof date,
  typeof error
]

export type DefaultRevivableModule = DefaultRevivableModules[number]

export const findModuleForValue = <T extends Capable, T2 extends RevivableContext>(
  value: T,
  context: T2
): ReplaceWithBox<T, T2['revivableModules'][number]> => {
  type ReturnCastType = ReplaceWithBox<T, T2['revivableModules'][number]>
  const handledByModule = context.revivableModules.find(module => module.isType(value))
  if (handledByModule?.isType(value)) {
    return handledByModule.box(value as ExtractBoxInput<typeof handledByModule>, context) as ReturnCastType
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
    return handledByModule.box(value as ExtractBoxInput<typeof handledByModule>, context) as ReturnCastType
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
    return handledByModule.box(value as ExtractBoxInput<typeof handledByModule>, context) as ReturnCastType
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
    return handledByModule.revive(value as ExtractReviveInput<typeof handledByModule>, context) as ReturnCastType
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
      return handledByModule.revive(value as ExtractReviveInput<typeof handledByModule>, context) as ReturnCastType
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

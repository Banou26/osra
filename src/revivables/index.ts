import type { ExtractBoxInput, RevivableContext } from './utils'
import type { DeepReplaceWithModule, ReplaceWithModule } from '../utils/replace'

import { Capable, OSRA_BOX } from '../types'
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
): ReplaceWithModule<T, T2['revivableModules'][number]> => {
  type ReturnCastType = ReplaceWithModule<T, T2['revivableModules'][number]>
  const handledByModule = context.revivableModules.find(module => module.isType(value))
  if (handledByModule?.isType(value)) {
    return handledByModule.box(value as ExtractBoxInput<typeof handledByModule>, context) as ReturnCastType
  }
  return value as ReturnCastType
}

export const box = <T extends Capable, T2 extends RevivableContext>(
  value: T,
  context: T2
): ReplaceWithModule<T, T2['revivableModules'][number]> => {
  type ReturnCastType = ReplaceWithModule<T, T2['revivableModules'][number]>
  const handledByModule = context.revivableModules.find(module => module.isType(value))
  if (handledByModule?.isType(value)) {
    return handledByModule.box(value as ExtractBoxInput<typeof handledByModule>, context) as ReturnCastType
  }
  return value as ReturnCastType
}

export const recursiveBox = <T extends Capable, T2 extends RevivableContext>(
  value: T,
  context: T2
): DeepReplaceWithModule<T, T2['revivableModules'][number]> => {
  type ReturnCastType = DeepReplaceWithModule<T, T2['revivableModules'][number]>

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

import type { RevivableContextBase } from './utils'

import { OSRA_BOX } from '../types'
import * as arrayBuffer from './array-buffer'
import * as date from './date'
import * as error from './error'

export const BoxBase = {
  [OSRA_BOX]: 'revivable',
  type: '' as string
} as const

export type BoxBase = typeof BoxBase

// Uses RevivableContextBase to avoid circular type dependency
export type RevivableModule = {
  type: string
  isType: (value: any) => value is any
  box: (value: any, context: RevivableContextBase) => BoxBase
  revive: (value: any, context: RevivableContextBase) => any
}

export const defaultRevivableModules = [
  arrayBuffer,
  date,
  error
] satisfies RevivableModule[]

export type DefaultRevivableModules = typeof defaultRevivableModules // Cannot do this because of recursive types

export type DefaultRevivableModule = DefaultRevivableModules[number]

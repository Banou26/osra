import type { DefaultRevivableModules, InferMessages, RevivableModule } from '.'
import type { Message, MessageVariant, Transport, Uuid } from '../types'
import type { TypedEventTarget } from '../utils/typed-event-target'

import { OSRA_BOX } from '../types'

export declare const UnderlyingType: unique symbol
export type UnderlyingType = typeof UnderlyingType

export const BoxBase = {
  [OSRA_BOX]: 'revivable',
  type: '' as string
} as const

export type BoxBase<T extends string = string> =
  & typeof BoxBase
  & { type: T }

/**
 * Base constraint for module-owned wire messages.
 * Modules that send messages declare `export type Messages` extending this.
 */
export type MessageFields = { type: string; remoteUuid: Uuid }

/**
 * CustomEvent detail for the connection's shared event target.
 * Parameterized by active modules so the union reflects available messages.
 */
export type CustomMessageEvent<TModules extends readonly RevivableModule[] = DefaultRevivableModules> =
  CustomEvent<Message | InferMessages<TModules>>

/**
 * Event map for the connection's typed event target.
 */
export type RevivablesMessageEventMap<TModules extends readonly RevivableModule[] = DefaultRevivableModules> = {
  message: CustomMessageEvent<TModules>
}

export type RevivablesMessageEventTarget<TModules extends readonly RevivableModule[] = DefaultRevivableModules> =
  TypedEventTarget<RevivablesMessageEventMap<TModules>>

export type RevivableContext<TModules extends readonly RevivableModule[] = DefaultRevivableModules> = {
  transport: Transport
  remoteUuid: Uuid
  messagePorts: Set<MessagePort>
  sendMessage: (message: MessageVariant | InferMessages<TModules>) => void
  revivableModules: TModules
  eventTarget: RevivablesMessageEventTarget<TModules>
  unregisterSignal?: AbortSignal
}

export type ExtractModule<T> = T extends { isType: (value: unknown) => value is infer S } ? S : never
export type ExtractType<T> = T extends { isType: (value: unknown) => value is infer S } ? S : never
export type ExtractBoxInput<T> = T extends { box: (value: infer S) => value is any } ? S : never
export type ExtractReviveInput<T> = T extends { revive: (value: infer S) => value is any } ? S : never
export type ExtractBox<T> = T extends { box: (...args: any[]) => infer B } ? B : never
export type InferRevivables<TModules extends readonly unknown[]> =
  ExtractType<TModules[number]>
export type InferRevivableBox<TModules extends readonly unknown[]> =
  ExtractBox<TModules[number]>

export const isRevivableBox = <T extends RevivableContext<readonly RevivableModule[]>>(value: any, _context: T): value is InferRevivableBox<T['revivableModules']> =>
  value
  && typeof value === 'object'
  && OSRA_BOX in value
  && value[OSRA_BOX] === 'revivable'

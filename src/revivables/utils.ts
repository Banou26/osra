import type { DefaultRevivableModules, RevivableModule } from '.'
import type { ConnectionMessage, MessageEventTarget, Transport, Uuid } from '../types'
import type { MessageChannelAllocator, PlatformCapabilities } from '../utils'

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

export type RevivableContext<TModules extends readonly RevivableModule[] = DefaultRevivableModules> = {
  platformCapabilities: PlatformCapabilities
  transport: Transport
  remoteUuid: Uuid
  messagePorts: Set<MessagePort>
  messageChannels: MessageChannelAllocator
  sendMessage: (message: ConnectionMessage) => void
  revivableModules: TModules
  eventTarget: MessageEventTarget
  /**
   * Per-connection identity tables — populated only by the `identity`
   * revivable module. Non-wrapped values never touch these. See
   * `src/revivables/identity.ts`.
   */
  outgoingIdentityIds: WeakMap<object, Uuid>
  outgoingIdentitiesById: Map<Uuid, WeakRef<object>>
  revivedIdentitiesById: Map<Uuid, WeakRef<object>>
  identityCleanupRegistry: FinalizationRegistry<Uuid>
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

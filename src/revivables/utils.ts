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
   * Identity tables for every object-typed revivable value. The same reference
   * sent twice over the same connection dedupes to the same revived reference
   * on the other side, which preserves pass-by-reference semantics across the
   * wire (so `addEventListener(fn) + removeEventListener(fn)` works, and the
   * same MessagePort or class instance round-trips to the same object both
   * times). Maintained by `recursiveBox` / `recursiveRevive`.
   */
  outgoingValueIds: WeakMap<object, Uuid>
  outgoingValuesById: Map<Uuid, WeakRef<object>>
  revivedValuesById: Map<Uuid, WeakRef<object>>
  /**
   * Per-connection FinalizationRegistry that fires when a revived proxy is
   * garbage collected. Evicts the local `revivedValuesById` entry and sends a
   * `revivable-drop` message so the box side can evict its outgoing entry.
   * Held value is just the id; the callback closes over the connection so we
   * don't allocate a per-revive held-value object.
   */
  revivableCleanupRegistry: FinalizationRegistry<Uuid>
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

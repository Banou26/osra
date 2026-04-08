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
   * Identity tables for the function revivable. Let the same function sent
   * twice over the same connection dedupe to a single revived reference on
   * the other side (so `addEventListener(fn) + removeEventListener(fn)`
   * works). See `src/revivables/function.ts` for how they're used.
   */
  // eslint-disable-next-line @typescript-eslint/ban-types
  outgoingFunctionIds: WeakMap<Function, Uuid>
  // eslint-disable-next-line @typescript-eslint/ban-types
  outgoingFunctionsById: Map<Uuid, WeakRef<Function>>
  // eslint-disable-next-line @typescript-eslint/ban-types
  revivedFunctionsById: Map<Uuid, WeakRef<Function>>
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

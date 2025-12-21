import type { DefaultRevivableModules, RevivableModule } from '.'
import type { ConnectionMessage, MessageEventTarget, Transport, Uuid } from '../types'
import type { MessageChannelAllocator, PlatformCapabilities } from '../utils'

import { OSRA_BOX } from '../types'

export type RevivableContext<TModules extends RevivableModule[] = DefaultRevivableModules> = {
  platformCapabilities: PlatformCapabilities
  transport: Transport
  remoteUuid: Uuid
  messagePorts: Set<MessagePort>
  messageChannels: MessageChannelAllocator
  sendMessage: (message: ConnectionMessage) => void
  revivableModules: TModules
  eventTarget: MessageEventTarget
}

// type ContextRevivableBoxes =
  
export type ExtractType<T> = T extends { readonly type: infer U } ? U : never

export type ExtractBox<T> = T extends { box: (...args: any[]) => infer B } ? B : never
export type InferRevivableBox<TModules extends readonly unknown[]> =
  ExtractBox<TModules[number]>

export const isRevivableBox = <T extends RevivableContext>(value: any, context: T): value is InferRevivableBox<T['revivableModules']> =>
  value
  && typeof value === 'object'
  && OSRA_BOX in value
  && value[OSRA_BOX] === 'revivable'

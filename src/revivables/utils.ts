import type { DefaultRevivableModules, RevivableModule } from '.'
import type { ConnectionMessage, MessageEventTarget, Transport, Uuid } from '../types'
import type { MessageChannelAllocator, PlatformCapabilities } from '../utils'

import { OSRA_BOX } from '../types'

// Base context type without the generic - used by module definitions to avoid circular types
export type RevivableContextBase = {
  platformCapabilities: PlatformCapabilities
  transport: Transport
  remoteUuid: Uuid
  messagePorts: Set<MessagePort>
  messageChannels: MessageChannelAllocator
  sendMessage: (message: ConnectionMessage) => void
  revivableModules: RevivableModule[]
  eventTarget: MessageEventTarget
}

// Full context with typed modules - use this when you need the specific module types
export type RevivableContext<TModules extends RevivableModule[] = DefaultRevivableModules> =
  Omit<RevivableContextBase, 'revivableModules'> & {
    revivableModules: TModules
  }

export type ExtractType<T> = T extends { readonly type: infer U } ? U : never

export type ExtractBox<T> = T extends { box: (...args: any[]) => infer B } ? B : never
export type InferRevivableBox<TModules extends readonly unknown[]> =
  ExtractBox<TModules[number]>

export const isRevivableBox = <T extends RevivableContext>(value: any, _context: T): value is InferRevivableBox<T['revivableModules']> =>
  value
  && typeof value === 'object'
  && OSRA_BOX in value
  && value[OSRA_BOX] === 'revivable'

const value = new ArrayBuffer()

if (isRevivableBox(value, {} as RevivableContext)) {
  console.log('is revivable box', value)
} else {
  console.log('not revivable box', value)
}

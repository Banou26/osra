import type { DefaultRevivableModules, RevivableModule } from '.'
import type { ConnectionMessage, MessageEventTarget, Transport, Uuid } from '../types'
import type { MessageChannelAllocator, PlatformCapabilities } from '../utils'

import { OSRA_BOX } from '../types'

export type RevivableContext<TModules extends readonly RevivableModule[] = DefaultRevivableModules> = {
  platformCapabilities: PlatformCapabilities
  transport: Transport
  remoteUuid: Uuid
  messagePorts: Set<MessagePort>
  messageChannels: MessageChannelAllocator
  sendMessage: (message: ConnectionMessage) => void
  revivableModules: TModules
  eventTarget: MessageEventTarget
}

export type ExtractModule<T> = T extends { isType: (value: unknown) => value is infer S } ? S : never
export type ExtractType<T> = T extends { isType: (value: unknown) => value is infer S } ? S : never
export type ExtractBoxInput<T> = T extends { box: (value: infer S) => value is any } ? S : never
export type ExtractReviveInput<T> = T extends { revive: (value: infer S) => value is any } ? S : never
// export type ExtractType<T> = T extends { readonly type: infer U } ? U : never
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

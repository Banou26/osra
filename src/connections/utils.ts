import type {
  Message, MessageVariant, Uuid,
  Capable, MessageEventMap
} from '../types'
import type { DefaultRevivableModules, RevivableModule } from '../revivables'
import type { Transport } from '../utils/transport'
import type { ConnectionContext } from '.'
import type { TypedEventTarget } from '../utils/typed-event-target'

import { defaultRevivableModules } from '../revivables'
import { isJsonOnlyTransport, isCustomTransport } from '../utils/type-guards'

export const normalizeTransport = (transport: Transport): Transport => {
  const isJson =
    'isJson' in transport && transport.isJson !== undefined
      ? transport.isJson
      : isJsonOnlyTransport(transport)
  const ports =
    isCustomTransport(transport)
      ? transport
      : { emit: transport, receive: transport }
  return { isJson, ...ports } satisfies Transport
}

export const mergeRevivableModules = <
  TUserModules extends readonly RevivableModule[]
>(userModules: TUserModules | undefined) => [
  ...defaultRevivableModules.filter(
    d => !(userModules ?? []).some(u => u.type === d.type),
  ),
  ...(userModules ?? []),
] as const

export type ProtocolEventMap<
  TModules extends readonly RevivableModule[] = DefaultRevivableModules
> = {
  message: CustomEvent<Message<TModules>>
}

export type ProtocolEventTarget<
  TModules extends readonly RevivableModule[] = DefaultRevivableModules
> = TypedEventTarget<ProtocolEventMap<TModules>>

export type ProtocolContext<
  TModules extends readonly RevivableModule[] = DefaultRevivableModules
> = {
  transport: Transport
  value: Capable<TModules>
  revivableModules: TModules
  connectionContexts: Map<string, ConnectionContext<TModules>>
  getUuid: () => Uuid
  presetRemoteUuid?: Uuid
  sendMessage: (message: MessageVariant) => void
  protocolEventTarget: ProtocolEventTarget<TModules>
  resolveRemoteValue: (value: Capable<TModules>) => void
  createConnectionEventTarget: () => TypedEventTarget<MessageEventMap<TModules>>
}

export type StartConnectionsOptions<
  TUserModules extends readonly RevivableModule[] = readonly []
> = {
  transport: Transport
  name?: string
  remoteName?: string
  key?: string
  origin?: string
  unregisterSignal?: AbortSignal
  revivableModules?: TUserModules
  uuid?: Uuid
  remoteUuid?: Uuid
}

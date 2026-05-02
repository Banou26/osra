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

/** Resolves the final revivable module list. The user supplies a function
 *  that takes the defaults and returns whatever ordering/composition they
 *  want — add modules, drop defaults, reorder, override per-type. When
 *  omitted, the defaults are used as-is. */
export const mergeRevivableModules = <
  TModules extends readonly RevivableModule[] = DefaultRevivableModules
>(
  configure: ((defaults: DefaultRevivableModules) => TModules) | undefined,
): TModules =>
  configure
    ? configure(defaultRevivableModules)
    : defaultRevivableModules as unknown as TModules

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
  TModules extends readonly RevivableModule[] = DefaultRevivableModules
> = {
  transport: Transport
  name?: string
  remoteName?: string
  key?: string
  origin?: string
  unregisterSignal?: AbortSignal
  /** Configure the revivable module list. Receives the defaults and
   *  returns the final ordered list — add modules, drop defaults, reorder,
   *  or override per-type as needed. */
  revivableModules?: (defaults: DefaultRevivableModules) => TModules
  uuid?: Uuid
  remoteUuid?: Uuid
}

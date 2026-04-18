import type { DefaultRevivableModules, RevivableModule } from '../revivables'
import type { ConnectionContext as BidirectionalConnectionContext } from './bidirectional'
import type {
  ProtocolContext,
  StartConnectionsOptions,
} from '../utils'
import type {
  Message, MessageVariant, Uuid,
  Capable,
} from '../types'
import type { MessageContext } from '../utils/transport'

import { OSRA_DEFAULT_KEY, OSRA_KEY } from '../types'
import * as bidirectional from './bidirectional'
import {
  isEmitTransport,
  isReceiveTransport,
} from '../utils/type-guards'
import { createTypedEventTarget } from '../utils/typed-event-target'
import { getTransferableObjects } from '../utils/transferable'
import { registerOsraMessageListener, sendOsraMessage } from '../utils/transport'
import { mergeRevivableModules, normalizeTransport } from './utils'

export * from './bidirectional'
export * from './utils'

export type ConnectionModule<T> = {
  readonly type: string
  // ProtocolContext<any> rather than ProtocolContext<readonly RevivableModule[]>
  // for the same bivariance reason as RevivableModule.box — concrete modules
  // declare narrower context generics than the shared interface can express.
  readonly init: (ctx: ProtocolContext<any>) => void
  readonly Messages?: T
}

export const connections = [
  bidirectional
] as const

export type DefaultConnectionModules = typeof connections
export type DefaultConnectionModule = DefaultConnectionModules[number]

export type ConnectionMessage<
  TModules extends readonly RevivableModule[] = DefaultRevivableModules,
  T extends Capable<TModules> = Capable<TModules>
> =
  DefaultConnectionModule extends {
    Messages: (modules: TModules, value: T) => infer R
  }
    ? R
    : never

export type ConnectionContext<
  TModules extends readonly RevivableModule[] = DefaultRevivableModules
> =
  | BidirectionalConnectionContext<TModules>

export const startConnections = <
  T = unknown,
  const TUserModules extends readonly RevivableModule[] = readonly []
>(
  value: Capable<[...DefaultRevivableModules, ...TUserModules]>,
  {
    transport: _transport,
    name,
    remoteName,
    key = OSRA_DEFAULT_KEY,
    origin = '*',
    unregisterSignal,
    revivableModules: _userRevivableModules
  }: StartConnectionsOptions<TUserModules>
): Promise<T> => {
  const transport = normalizeTransport(_transport)
  const mergedRevivableModules = mergeRevivableModules(_userRevivableModules)
  type MergedModules = typeof mergedRevivableModules
  const connectionContexts = new Map<string, ConnectionContext<MergedModules>>()

  const { promise: remoteValuePromise, resolve: resolveRemoteValue } =
    Promise.withResolvers<Capable<MergedModules>>()

  let uuid: Uuid = globalThis.crypto.randomUUID()

  const sendMessage = (message: MessageVariant) => {
    if (unregisterSignal?.aborted) return
    if (!isEmitTransport(transport)) return
    const envelope = { [OSRA_KEY]: key, name, uuid, ...message }
    sendOsraMessage(transport, envelope, origin, getTransferableObjects(envelope))
  }

  const protocolEventTarget = createTypedEventTarget<{ message: CustomEvent<Message<MergedModules>> }>()

  const ctx: ProtocolContext<MergedModules> = {
    transport,
    value: value as Capable<MergedModules>,
    revivableModules: mergedRevivableModules,
    connectionContexts,
    getUuid: () => uuid,
    rerollUuid: () => uuid = globalThis.crypto.randomUUID(),
    sendMessage,
    protocolEventTarget,
    resolveRemoteValue,
    createConnectionEventTarget: createTypedEventTarget,
  }

  const listener = (message: Message<MergedModules>, _: MessageContext) => {
    // own message looped back on the channel
    if (message.uuid === uuid) return
    protocolEventTarget.dispatchEvent(
      new CustomEvent('message', { detail: message }),
    )
  }

  if (isReceiveTransport(transport)) {
    registerOsraMessageListener({
      listener,
      transport,
      remoteName,
      key,
      unregisterSignal
    })
  }

  for (const connectionModule of connections) {
    connectionModule.init(ctx)
  }

  return remoteValuePromise as Promise<T>
}

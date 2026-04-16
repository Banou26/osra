import type { DefaultRevivableModules, RevivableModule } from '../revivables'
import type {
  Messages as BidirectionalMessages,
  BidirectionalConnectionContext
} from './bidirectional'
import type {
  ProtocolContext,
  ProtocolEventTarget,
  StartConnectionsOptions
} from '../utils'
import type {
  Message, MessageVariant, Uuid,
  Capable, MessageEventMap
} from '../types'
import type { MessageContext } from '../utils/transport'
import type { TypedEventTarget } from '../utils/typed-event-target'

import { OSRA_DEFAULT_KEY, OSRA_KEY } from '../types'
import {
  isEmitTransport,
  isReceiveTransport
} from '../utils/type-guards'
import { getTransferableObjects } from '../utils/transferable'
import { registerOsraMessageListener, sendOsraMessage } from '../utils/transport'

import { connections, mergeRevivableModules, normalizeTransport } from './utils'

export * from './bidirectional'
export * from './utils'

export type ConnectionMessage<
  TModules extends readonly RevivableModule[] = DefaultRevivableModules
> =
  | BidirectionalMessages<TModules>

export type ConnectionContext<
  TModules extends readonly RevivableModule[] = DefaultRevivableModules
> =
  | BidirectionalConnectionContext<TModules>

/**
  * Protocol mode:
  * - Bidirectional mode
  *
  * Transport modes:
  * - Capable mode
  * - JSON mode
  */
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

  let resolveRemoteValue: (connection: T) => void
  const remoteValuePromise = new Promise<T>((resolve) => {
    resolveRemoteValue = resolve
  })

  let uuid: Uuid = globalThis.crypto.randomUUID()
  let aborted = false
  if (unregisterSignal) {
    unregisterSignal.addEventListener('abort', () => {
      aborted = true
    })
  }

  const sendMessage = (message: MessageVariant) => {
    if (aborted) return
    if (!isEmitTransport(transport)) return
    const transferables = getTransferableObjects(message)
    sendOsraMessage(
      transport,
      {
        [OSRA_KEY]: key,
        name,
        uuid,
        ...message
      },
      origin,
      transferables
    )
  }

  const protocolEventTarget =
    new EventTarget() as ProtocolEventTarget<MergedModules>

  const ctx: ProtocolContext<MergedModules> = {
    transport,
    value: value as Capable<MergedModules>,
    revivableModules: mergedRevivableModules,
    connectionContexts,
    getUuid: () => uuid,
    rerollUuid: () => uuid = globalThis.crypto.randomUUID(),
    sendMessage,
    protocolEventTarget,
    resolveRemoteValue: (v) => resolveRemoteValue(v as T),
    createConnectionEventTarget: () =>
      new EventTarget() as TypedEventTarget<MessageEventMap<MergedModules>>
  }

  const listener = async (message: Message, _: MessageContext) => {
    // own message looped back on the channel
    if (message.uuid === uuid) return
    protocolEventTarget.dispatchEvent(
      new CustomEvent('message', { detail: message as Message<MergedModules> })
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
    connectionModule.init(ctx as ProtocolContext<any>)
  }

  return remoteValuePromise
}

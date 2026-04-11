import type {
  EmitTransport, Message,
  MessageContext, MessageVariant,
  Capable, Transport,
} from './types'
export type { UnderlyingType } from './revivables/utils'
import type {
  ConnectionContext,
  BidirectionalConnectionContext
} from './utils'
import type { RevivablesMessageEventMap } from './revivables/utils'

import type { InferMessages, RevivableModule } from './revivables'

import { OSRA_DEFAULT_KEY, OSRA_KEY } from './types'
import { defaultRevivableModules } from './revivables'
export { BoxBase } from './revivables/utils'
import {
  registerOsraMessageListener,
  sendOsraMessage,
  startBidirectionalConnection,
  isReceiveTransport,
  isEmitTransport,
  startUnidirectionalEmittingConnection,
  getTransferableObjects,
  isJsonOnlyTransport,
  isCustomTransport,
  DeepReplace,
  DeepReplaceAsync,
  AsCapable
} from './utils'
import { TypedEventTarget } from 'typescript-event-target'

export * from './types'
export * from './revivables'
export * from './utils'
export type {
  DeepReplace,
  DeepReplaceAsync,
  AsCapable
}

/**
 * Protocol mode:
 * - Bidirectional mode
 * - Unidirectional mode
 *
 * Transport modes:
 * - Capable mode
 * - JSON mode
 */
export const expose = async <
  T extends Capable,
  const TUserModules extends readonly RevivableModule[] = readonly RevivableModule[]
>(
  value: Capable,
  {
    transport: _transport,
    name,
    remoteName,
    key = OSRA_DEFAULT_KEY,
    origin = '*',
    unregisterSignal,
    logger,
    revivableModules: _userRevivableModules
  }: {
    transport: Transport
    name?: string
    remoteName?: string
    key?: string
    origin?: string
    unregisterSignal?: AbortSignal
    logger?: {}
    revivableModules?: TUserModules
  }
): Promise<T> => {
  const transport = {
    isJson:
      'isJson' in _transport && _transport.isJson !== undefined
        ? _transport.isJson
        : isJsonOnlyTransport(_transport),
    ...(
      isCustomTransport(_transport)
        ? _transport
        : {
          emit: _transport,
          receive: _transport
        }
    )
  } satisfies Transport
  const userRevivableModules = _userRevivableModules ?? []
  const mergedRevivableModules = [
    ...defaultRevivableModules.filter(
      d => !userRevivableModules.some(u => u.type === d.type),
    ),
    ...userRevivableModules,
  ] as const
  type MergedModules = typeof mergedRevivableModules
  type SendableMessage = MessageVariant | InferMessages<MergedModules>
  const connectionContexts = new Map<string, ConnectionContext<MergedModules>>()

  let resolveRemoteValue: (connection: T) => void
  const remoteValuePromise = new Promise<T>((resolve) => {
    resolveRemoteValue = resolve
  })

  let uuid = globalThis.crypto.randomUUID()
  
  
  let aborted = false
  if (unregisterSignal) {
    unregisterSignal.addEventListener('abort', () => {
      aborted = true
    })
  }

  const sendMessage = (transport: EmitTransport, message: SendableMessage) => {
    if (aborted) return
    const transferables = getTransferableObjects(message)
    sendOsraMessage(
      transport,
      {
        [OSRA_KEY]: key,
        name,
        uuid,
        ...message,
      } as Message,
      origin,
      transferables
    )
  }

  const listener = async (message: Message, messageContext: MessageContext) => {
    // means that our own message looped back on the channel
    if (message.uuid === uuid) return
    // Unidirectional receiving mode
    if (!isEmitTransport(transport)) {
      // Handle non bidirectional based messages here
      throw new Error('Unidirectional receiving mode not implemented')
    }
    // Bidirectional mode
    if (message.type === 'announce') {
      if (!message.remoteUuid) {
        sendMessage(transport, { type: 'announce', remoteUuid: message.uuid })
        return
      }
      if (message.remoteUuid !== uuid) return
      // todo: re-add uuid collision handling
      if (connectionContexts.has(message.uuid)) {
        return
      }
      // Send announce back so the other side can also create a connection
      // (in case they missed our initial announce due to timing)
      sendMessage(transport, { type: 'announce', remoteUuid: message.uuid })
      const eventTarget = new TypedEventTarget<RevivablesMessageEventMap<MergedModules>>()
      const connectionContext = {
        type: 'bidirectional',
        eventTarget,
        connection:
          startBidirectionalConnection({
            transport,
            value,
            uuid,
            remoteUuid: message.uuid,
            eventTarget,
            unregisterSignal,
            send: (message: SendableMessage) => sendMessage(transport, message),
            close: () => void connectionContexts.delete(message.uuid),
            revivableModules: mergedRevivableModules,
          }),
      } satisfies BidirectionalConnectionContext<MergedModules>
      connectionContexts.set(message.uuid, connectionContext)
      connectionContext.connection.remoteValue.then((remoteValue) =>
        resolveRemoteValue(remoteValue as T)
      )
    } else if (message.type === 'reject-uuid-taken') {
      if (message.remoteUuid !== uuid) return
      uuid = globalThis.crypto.randomUUID()
      sendMessage(transport, { type: 'announce' })
    } else if (message.type === 'close') {
      if (message.remoteUuid !== uuid) return
      const connectionContext = connectionContexts.get(message.uuid)
      // We just drop the message if the remote uuid hasn't announced itself
      if (!connectionContext) {
        console.warn(`Connection not found for remoteUuid: ${message.uuid}`)
        return
      }
      connectionContext.connection.close()
      connectionContexts.delete(message.uuid)
    } else { //  "init" | "message" | "message-port-close"
      if (message.remoteUuid !== uuid) return
      const connection = connectionContexts.get(message.uuid)
      // We just drop the message if the remote uuid hasn't announced itself
      if (!connection) {
        console.warn(`Connection not found for remoteUuid: ${message.uuid}`)
        return
      }
      if (connection.type !== 'unidirectional-emitting') {
        connection.eventTarget.dispatchTypedEvent(
          'message',
          new CustomEvent('message', { detail: message })
        )
      }
    }
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

  if (isEmitTransport(transport)) {
    sendMessage(transport, { type: 'announce' })
  }

  // Unidirectional emitting mode
  if (isEmitTransport(transport) && !isReceiveTransport(transport)) {
    const { remoteValueProxy } = startUnidirectionalEmittingConnection<T, MergedModules>({
      value,
      uuid,
      send: (message: SendableMessage) => sendMessage(transport, message),
      close: () => connectionContexts.delete(uuid)
    })
    return remoteValueProxy
  }

  return remoteValuePromise
}

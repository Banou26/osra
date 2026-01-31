import type {
  EmitTransport, Message,
  MessageContext, MessageVariant,
  Capable, Transport,
  MessageEventMap
} from './types'
export type { UnderlyingType } from './revivables/utils'
import type {
  PlatformCapabilities, ConnectionContext,
  BidirectionalConnectionContext
} from './utils'

import { OSRA_DEFAULT_KEY, OSRA_KEY } from './types'
export { BoxBase } from './revivables/utils'
import {
  probePlatformCapabilities,
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
export {
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
 * - Jsonable mode
 */
export const expose = async <T extends Capable>(
  value: Capable,
  {
    transport: _transport,
    name,
    remoteName,
    key = OSRA_DEFAULT_KEY,
    origin = '*',
    unregisterSignal,
    platformCapabilities: _platformCapabilities,
    transferAll,
    logger
  }: {
    transport: Transport
    name?: string
    remoteName?: string
    key?: string
    origin?: string
    unregisterSignal?: AbortSignal
    platformCapabilities?: PlatformCapabilities
    transferAll?: boolean
    logger?: {}
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
  const platformCapabilities = _platformCapabilities ?? await probePlatformCapabilities()
  const connectionContexts = new Map<string, ConnectionContext>()

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

  const sendMessage = (transport: EmitTransport, message: MessageVariant) => {
    if (aborted) return
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
      const eventTarget = new TypedEventTarget<MessageEventMap>()
      const connectionContext = {
        type: 'bidirectional',
        eventTarget,
        connection:
          startBidirectionalConnection({
            transport,
            value,
            uuid,
            remoteUuid: message.uuid,
            platformCapabilities,
            eventTarget,
            send: (message: MessageVariant) => sendMessage(transport, message),
            close: () => void connectionContexts.delete(message.uuid)
          })
      } satisfies BidirectionalConnectionContext
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
    const { remoteValueProxy } = startUnidirectionalEmittingConnection<T>({
      value,
      uuid,
      platformCapabilities,
      send: (message: MessageVariant) => sendMessage(transport, message),
      close: () => connectionContexts.delete(uuid)
    })
    return remoteValueProxy
  }

  return remoteValuePromise
}

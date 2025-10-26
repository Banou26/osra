import type {
  EmitTransport, Message,
  MessageContext, MessageVariant,
  Capable, Transport
} from './types'
import type {
  PlatformCapabilities, ConnectionContext,
  BidirectionalConnectionContext
} from './utils'

import { OSRA_DEFAULT_KEY, OSRA_KEY } from './types'
import {
  probePlatformCapabilities,
  registerOsraMessageListener,
  sendOsraMessage,
  startBidirectionalConnection,
  isReceiveTransport,
  isEmitTransport,
  startUnidirectionalEmittingConnection,
  getTransferableObjects,
  isJsonOnlyTransport
} from './utils'

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
      _transport.isJson
      ?? isJsonOnlyTransport(_transport),
    ..._transport
  }
  const platformCapabilities = _platformCapabilities ?? await probePlatformCapabilities()
  const connectionContexts = new Map<string, ConnectionContext>()

  let resolveRemoteValue: (connection: T) => void
  const remoteValuePromise = new Promise<T>((resolve) => {
    resolveRemoteValue = resolve
  })

  let uuid = globalThis.crypto.randomUUID()

  const sendMessage = (transport: EmitTransport, message: MessageVariant) => {
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
      if (connectionContexts.has(message.uuid)) {
        sendMessage(
          transport,
          { type: 'reject-uuid-taken', remoteUuid: message.uuid }
        )
        return
      }
      const { port1, port2 } = new MessageChannel()
      const connectionContext = {
        type: 'bidirectional',
        messagePort: port1,
        connection:
          startBidirectionalConnection({
            transport,
            value,
            uuid,
            remoteUuid: message.uuid,
            platformCapabilities,
            receiveMessagePort: port2,
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
        const transferables = getTransferableObjects(message)
        connection.messagePort.postMessage(message, transferables)
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

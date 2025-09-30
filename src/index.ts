import type {
  EmitTransport,
  Message,
  MessageContext,
  MessageVariant,
  Capable,
  Transport
} from './types'
import type { PlatformCapabilities, ConnectionContext, BidirectionalConnectionContext, BidirectionalConnection } from './utils'

import { OSRA_DEFAULT_KEY, OSRA_KEY } from './types'
import {
  probePlatformCapabilities,
  registerOsraMessageListener,
  sendOsraMessage,
  startBidirectionalConnection,
  isReceiveTransport,
  isEmitTransport,
  getTransferBoxes,
  startUnidirectionalEmittingConnection
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
    transport,
    name,
    remoteName,
    key = OSRA_DEFAULT_KEY,
    origin = '*',
    unregisterSignal,
    platformCapabilities: _platformCapabilities,
    boxAllTransferables,
  }: {
    transport: Transport
    name?: string
    remoteName?: string
    key?: string
    origin?: string
    unregisterSignal?: AbortSignal
    platformCapabilities?: PlatformCapabilities
    boxAllTransferables?: boolean
  }
): Promise<T> => {
  const platformCapabilities = _platformCapabilities ?? await probePlatformCapabilities()
  const connections = new Map<string, ConnectionContext>()

  let resolveRemoteValue: (connection: T) => void
  const remoteValuePromise = new Promise<T>((resolve) => {
    resolveRemoteValue = resolve
  })

  let uuid = globalThis.crypto.randomUUID()

  const sendMessage = (transport: EmitTransport, message: MessageVariant) => {
    const transferables = getTransferBoxes(message).map(box => box.value)
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
    // Unidirectional mode
    if (!isEmitTransport(transport)) {
      // Handle non bidirectional based messages here
      throw new Error('Unidirectional mode not implemented')
    }
    // Bidirectional mode
    if (message.type === 'announce') {
      if (!message.remoteUuid) {
        sendMessage(transport, { type: 'announce', remoteUuid: message.uuid })
        return
      }
      if (message.remoteUuid !== uuid) return
      if (connections.has(message.uuid)) {
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
            value,
            uuid,
            remoteUuid: message.uuid,
            platformCapabilities,
            receiveMessagePort: port2,
            send: (message: MessageVariant) => sendMessage(transport, message),
            close: () => void connections.delete(message.uuid)
          })
      } satisfies BidirectionalConnectionContext
      connections.set(message.uuid, connectionContext)
      connectionContext.connection.remoteValue.then((remoteValue) =>
        resolveRemoteValue(remoteValue as T)
      )
    } else if (message.type === 'reject-uuid-taken') {
      if (message.remoteUuid !== uuid) return
      uuid = globalThis.crypto.randomUUID()
      sendMessage(transport, { type: 'announce' })
    } else {
      if (message.remoteUuid !== uuid) return
      const connection = connections.get(message.uuid)
      // We just drop the message if the remote uuid hasn't announced itself
      if (!connection) {
        console.error(`Connection not found for remoteUuid: ${message.uuid}`)
        return
      }
      if (connection.type !== 'unidirectional-emitting') {
        connection.messagePort.postMessage()
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
    const { proxy } = startUnidirectionalEmittingConnection<T>({
      value,
      uuid,
      platformCapabilities,
      send: (message: MessageVariant) => sendMessage(transport, message),
      close: () => connections.delete(uuid)
    })
    return proxy
  }

  return remoteValuePromise
}

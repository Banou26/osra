import type {
  EmitTransport, Message,
  MessageContext, MessageVariant,
  Capable, Transport,
  MessageEventTarget,
  MessageEventMap
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
  isJsonOnlyTransport,
  isCustomTransport
} from './utils'
import { TypedEventTarget } from 'typescript-event-target'

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

  const createConnection = (remoteUuid: string, weAcknowledgedThem: boolean, theyAcknowledgedUs: boolean) => {
    if (connectionContexts.has(remoteUuid)) return
    const eventTarget = new TypedEventTarget<MessageEventMap>()
    const connectionContext = {
      type: 'bidirectional',
      eventTarget,
      connection: undefined!
    } as BidirectionalConnectionContext
    connectionContexts.set(remoteUuid, connectionContext)
    connectionContext.connection = startBidirectionalConnection({
      transport,
      value,
      uuid,
      remoteUuid,
      platformCapabilities,
      eventTarget,
      send: (message: MessageVariant) => sendMessage(transport, message),
      close: () => void connectionContexts.delete(remoteUuid),
      weAcknowledgedThem,
      theyAcknowledgedUs
    })
    connectionContext.connection.remoteValue.then((remoteValue) =>
      resolveRemoteValue(remoteValue as T)
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
        // Initial announce from remote - create connection (it will send acknowledge)
        createConnection(message.uuid, false, false)
        return
      }
      // Acknowledge from remote (has remoteUuid)
      if (message.remoteUuid !== uuid) return
      const connection = connectionContexts.get(message.uuid)
      if (connection) {
        // Forward to existing connection
        connection.eventTarget.dispatchTypedEvent(
          'message',
          new CustomEvent('message', { detail: message })
        )
      } else {
        // Startup race: they announced before we started listening
        createConnection(message.uuid, false, true)
      }
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

import type {
  EmitTransport,
  Message,
  MessageContext,
  MessageVariant,
  Messageable,
  Transport
} from './types'
import type { PlatformCapabilities, Connection } from './utils'

import { OSRA_DEFAULT_KEY, OSRA_KEY } from './types'
import {
  probePlatformCapabilities,
  registerOsraMessageListener,
  sendOsraMessage,
  getTransferableObjects,
  startConnection,
  isReceiveTransport,
  isEmitTransport,
  assertEmitTransport
} from './utils'

/**
 * Communication modes:
 * - Service mode
 * - Broadcast mode
 * - Pair mode
 *
 * Transport modes:
 * - Jsonable mode
 * - Messageable mode
 *
 * Protocol mode:
 * - Stateful mode
 * - Stateless mode
 */
export const expose = async <T extends Messageable>(
  value: Messageable,
  {
    transport,
    name,
    remoteName,
    key = OSRA_DEFAULT_KEY,
    origin = '*',
    unregisterSignal,
    platformCapabilities: _platformCapabilities
  }: {
    transport: Transport
    stateless?: boolean
    name?: string
    remoteName?: string
    key?: string
    origin?: string
    unregisterSignal?: AbortSignal
    platformCapabilities?: PlatformCapabilities
  }
): Promise<T> => {
  const platformCapabilities = _platformCapabilities ?? await probePlatformCapabilities()
  const connections = new Map<string, Connection>()

  let initialUuid = globalThis.crypto.randomUUID() as string

  const sendMessage = (transport: EmitTransport, message: MessageVariant) => {
    const transferables = getTransferableObjects(message)
    sendOsraMessage(
      transport,
      {
        [OSRA_KEY]: key,
        name,
        uuid: initialUuid,
        ...message
      },
      origin,
      transferables
    )
  }

  const listener = async (message: Message, messageContext: MessageContext) => {
    const { uuid: remoteUuid } = message
    if (message.type === 'announce') {
      if (connections.has(remoteUuid)) {
        assertEmitTransport(transport)
        sendMessage(
          transport,
          { type: 'reject-uuid-taken', remoteUuid }
        )
        return
      }
      const connection = startConnection({
        uuid: initialUuid,
        remoteUuid,
        platformCapabilities,
        close: () => void connections.delete(remoteUuid)
      })
      connections.set(remoteUuid, connection)
    } else if (message.type === 'message') {
      const connection = connections.get(remoteUuid)
      // We just drop the message if the remote uuid hasn't announced itself
      if (!connection) {
        console.error(`Connection not found for remoteUuid: ${remoteUuid}`)
        return
      }
      connection.receiveMessage(message, messageContext)
    } else if (message.type === 'reject-uuid-taken' && message.remoteUuid === initialUuid) {
      initialUuid = globalThis.crypto.randomUUID() as string
      assertEmitTransport(transport)
      sendMessage(transport, { type: 'announce' })
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

  return undefined as unknown as T
}

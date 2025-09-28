import type {
  Message,
  MessageContext,
  MessageVariant,
  Messageable,
  Transport
} from './types'
import type { PlatformCapabilities, ConnectionContext, Connection } from './utils'

import { OSRA_DEFAULT_KEY, OSRA_KEY } from './types'
import {
  probePlatformCapabilities,
  registerOsraMessageListener,
  sendOsraMessage,
  getTransferableObjects,
  startConnection,
  isReceiveTransport,
  isEmitTransport
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

  const sendMessage = (message: MessageVariant) => {
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
        sendMessage({
          type: 'reject-uuid-taken',
          remoteUuid
        })
        return
      }
      const connection = startConnection({
        remoteUuid,
        platformCapabilities,
        unregisterContext: () => connections.delete(remoteUuid)
      })
      connections.set(remoteUuid, connection)
    } else if (message.type === 'message') {
      const connection = connections.get(remoteUuid)
      if (!connection) {
        console.error(`Context not found for remoteUuid: ${remoteUuid}`)
        return
      }
      connection._rootMessagePort.postMessage(message)
    } else if (remote && message.type === 'reject-uuid-taken' && message.remoteUuid === initialUuid) {
      initialUuid = globalThis.crypto.randomUUID() as string
      sendMessage({ type: 'announce' })
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
    sendMessage({ type: 'announce' })
  }

  return undefined as unknown as T
}

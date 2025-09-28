import type {
  Message,
  MessageVariant,
  Messageable,
  Transport
} from './types'
import type { PlatformCapabilities, Context } from './utils'

import { OSRA_DEFAULT_KEY, OSRA_KEY } from './types'
import {
  probePlatformCapabilities,
  registerOsraMessageListener,
  makeNewContext,
  sendOsraMessage,
  getTransferableObjects
} from './utils'

const startConnection = ({ platformCapabilities, context }: { platformCapabilities: PlatformCapabilities, context: Context }) => {
  const { uuid, remoteUuid, messagePort } = context

  messagePort.addEventListener('message', (event: MessageEvent<Message>) => {

  })
}

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
export const expose = async <JsonOnly extends boolean, T extends Messageable>(
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
  const contexts = new Map<string, Context>()

  let initialUuid = globalThis.crypto.randomUUID() as string

  const sendMessage = (message: MessageVariant) => {
    const transferables = getTransferableObjects(message)
    sendOsraMessage(
      transport,
      {
        [OSRA_KEY]: true,
        key,
        name,
        uuid: initialUuid,
        ...message
      },
      origin,
      transferables
    )
  }

  const listener = async (message: Message) => {
    const { uuid: remoteUuid } = message
    if (message.type === 'announce') {
      if (contexts.has(remoteUuid)) {
        sendMessage({
          type: 'reject-uuid-taken',
          remoteUuid
        })
        return
      }
      const context = makeNewContext({
        remoteUuid,
        platformCapabilities,
        unregisterContext: () => contexts.delete(remoteUuid)
      })
      contexts.set(remoteUuid, context)
      startConnection({ platformCapabilities, context })
    } else if (message.type === 'message') {
      const context = contexts.get(remoteUuid)
      if (!context) {
        console.error(`Context not found for remoteUuid: ${remoteUuid}`)
        return
      }
      context._rootMessagePort.postMessage(message)
    } else if (remote && message.type === 'reject-uuid-taken' && message.remoteUuid === initialUuid) {
      initialUuid = globalThis.crypto.randomUUID() as string
      sendMessage({ type: 'announce' })
    }
  }

  registerOsraMessageListener({
    listener,
    local,
    remoteName,
    key,
    unregisterSignal
  })

  if (remote) {
    sendMessage({ type: 'announce' })
  }

  return undefined as unknown as T
}

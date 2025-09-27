import type {
  Message,
  StructuredCloneTransferableProxiable,
  MessageVariant,
  Transport
} from './types'
import type { PlatformCapabilities, Context } from './utils'

import { DEFAULT_KEY, OSRA_KEY } from './types'
import {
  probePlatformCapabilities,
  registerLocalTargetListeners,
  makeNewContext,
  postOsraMessage,
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
export const expose = async <T extends StructuredCloneTransferableProxiable>(
  value: StructuredCloneTransferableProxiable,
  {
    transport,
    name,
    remoteName,
    key = DEFAULT_KEY,
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
    if (!remote) throw new Error('No remote target provided')
    const transferables = getTransferableObjects(message)
    postOsraMessage(
      remote,
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

  registerLocalTargetListeners({
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

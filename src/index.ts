import type {
  OsraMessage,
  StructuredCloneTransferableProxiable,
  LocalTargetOrFunction,
  RemoteTargetOrFunction
} from './types'
import type { Capabilities, Context } from './utils'

import { OSRA_MESSAGE_KEY, OSRA_MESSAGE_PROPERTY } from './types'
import {
  probeCapabilities,
  registerLocalTargetListeners,
  makeNewContext,
  postOsraMessage
} from './utils'

const startConnection = ({ capabilities, context }: { capabilities: Capabilities, context: Context }) => {
  const { uuid, remoteUuid, messagePort } = context

  messagePort.addEventListener('message', (event: MessageEvent<OsraMessage>) => {

  })
}

/**
 * Starts listening for messages on the local target(window, worker, ect...)
 * - Service mode is a 1-many connection between the local target and many remote targets.
 *   - Mostly used around many to many communication channels like BroadcastChannel, SharedWorker, WebExtensions, etc...
 *   - Can pass initial values to remote contexts, useful for passing configs around.
 *
 * If a remote is passed, it will switch from service mode to pairing mode.
 * - Pairing mode establishes a 1-1 connection between the local and remote target.
 *    - Allows for passing initial values between the contexts easily.
 *    - Is especially useful for defining exports at the top level using TLA(top level await)
 *
 * Capable of utilizing transferable objects for efficient data transfer in supported environments.
 */
export const expose = async <T extends StructuredCloneTransferableProxiable>(
  value: StructuredCloneTransferableProxiable,
  {
    local,
    name,
    remote,
    remoteName,
    key = OSRA_MESSAGE_KEY,
    origin = '*',
    unregisterSignal,
    capabilities: _capabilities
  }: {
    local: LocalTargetOrFunction
    name?: string
    remote?: RemoteTargetOrFunction
    remoteName?: string
    key?: string
    origin?: string,
    unregisterSignal?: AbortSignal,
    capabilities?: Capabilities
  }
): Promise<T> => {
  const capabilities = _capabilities ?? await probeCapabilities()
  const contexts = new Map<string, Context>()

  const initialUuid =
    remote
      ? globalThis.crypto.randomUUID() as string
      : undefined

  const listener = async (message: OsraMessage) => {
    const { uuid: remoteUuid } = message
    const foundContext = contexts.get(remoteUuid)
    const context =
      foundContext
      ?? makeNewContext({
        remoteUuid,
        capabilities,
        unregisterContext: () => contexts.delete(remoteUuid)
      })
    if (!foundContext) {
      contexts.set(remoteUuid, context)
      startConnection({ capabilities, context })
    }
    context._rootMessagePort.postMessage(message)
  }

  registerLocalTargetListeners({
    listener,
    local,
    remoteName,
    key,
    unregisterSignal
  })

  if (remote && initialUuid) {
    postOsraMessage(
      remote,
      {
        [OSRA_MESSAGE_PROPERTY]: true,
        key,
        name,
        type: 'announce',
        uuid: initialUuid,
      }
    )
  }

  return undefined as unknown as T
}

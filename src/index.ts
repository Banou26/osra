import type { RemoteTarget, LocalTarget, OsraMessage, StructuredCloneTransferableProxiableType, LocalTargetOrFunction, RemoteTargetOrFunction } from './types'

import { OSRA_MESSAGE_KEY, OSRA_MESSAGE_PROPERTY } from './types'
import { checkOsraMessageKey, isWebExtensionOnMessage, registerLocalTargetListeners } from './utils'


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
export const expose = async <T extends StructuredCloneTransferableProxiableType>(
  value: StructuredCloneTransferableProxiableType,
  {
    local,
    remote,
    key = OSRA_MESSAGE_KEY,
    origin = '*',
    unregisterSignal
  }: {
    local: LocalTargetOrFunction
    remote?: RemoteTargetOrFunction
    key?: string
    origin?: string,
    unregisterSignal?: AbortSignal
  }
): Promise<T> => {
  const uuid = globalThis.crypto.randomUUID()
  const remotes = new Map<string, any>()

  const listener = async (message: OsraMessage) => {

  }

  registerLocalTargetListeners({ listener, local, key, unregisterSignal })
}

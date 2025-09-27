import type { OsraMessage } from '../types'
import type { PlatformCapabilities } from './capabilities'

export type Context = {
  uuid: string
  remoteUuid: string
  capabilities: PlatformCapabilities
  messagePort: MessagePort
  _rootMessagePort: MessagePort
  unregisterContext: () => void
  localMessagePortProxys: Map<MessagePort, number>
  remoteMessagePortProxys: Map<number, MessagePort>
  localFunctions: WeakMap<Function, number>
  remoteFunctions: Map<number, Function>
}

export const makeNewContext = (
  { uuid, remoteUuid, capabilities, unregisterContext }:
  { uuid?: string, remoteUuid: string, capabilities: PlatformCapabilities, unregisterContext: () => void }
) => {
  const { port1, port2 } = new MessageChannel()

  return ({
    uuid: uuid ?? globalThis.crypto.randomUUID() as string,
    remoteUuid,
    capabilities,
    messagePort: port1,
    _rootMessagePort: port2,
    unregisterContext,
    localMessagePortProxys: new Map<MessagePort, number>(),
    remoteMessagePortProxys: new Map<number, MessagePort>(),
    localFunctions: new WeakMap<Function, number>(),
    remoteFunctions: new Map<number, Function>()
  }) satisfies Context
}

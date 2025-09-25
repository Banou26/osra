import type { OsraMessage } from '../types'
import type { Capabilities } from './capabilities'

export type Context = {
  uuid: string
  remoteUuid: string
  capabilities: Capabilities
  messagePort: MessagePort
  _rootMessagePort: MessagePort
  localMessagePortProxys: Map<MessagePort, number>
  remoteMessagePortProxys: Map<number, MessagePort>
  localFunctions: WeakMap<Function, number>
  remoteFunctions: Map<number, Function>
}

export const makeNewContext = (
  { uuid, remoteUuid, capabilities }:
  { uuid?: string, remoteUuid: string, capabilities: Capabilities }
) => {
  const { port1, port2 } = new MessageChannel()

  return ({
    uuid: uuid ?? globalThis.crypto.randomUUID() as string,
    remoteUuid,
    capabilities,
    messagePort: port1,
    _rootMessagePort: port2,
    localMessagePortProxys: new Map<MessagePort, number>(),
    remoteMessagePortProxys: new Map<number, MessagePort>(),
    localFunctions: new WeakMap<Function, number>(),
    remoteFunctions: new Map<number, Function>()
  }) satisfies Context
}

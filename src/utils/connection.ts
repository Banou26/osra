import type { Message } from '../types'
import type { PlatformCapabilities } from './capabilities'

export type ConnectionContext = {
  uuid: string
  remoteUuid: string
  platformCapabilities: PlatformCapabilities
  messagePort: MessagePort
  _rootMessagePort: MessagePort
  unregisterContext: () => void
  localMessagePortProxys: Map<MessagePort, number>
  remoteMessagePortProxys: Map<number, MessagePort>
  localFunctions: WeakMap<Function, number>
  remoteFunctions: Map<number, Function>
}

export const makeNewConnectionContext = (
  { uuid, remoteUuid, platformCapabilities, unregisterContext }:
  { uuid?: string, remoteUuid: string, platformCapabilities: PlatformCapabilities, unregisterContext: () => void }
) => {
  const { port1, port2 } = new MessageChannel()

  return ({
    uuid: uuid ?? globalThis.crypto.randomUUID() as string,
    remoteUuid,
    platformCapabilities,
    messagePort: port1,
    _rootMessagePort: port2,
    unregisterContext,
    localMessagePortProxys: new Map<MessagePort, number>(),
    remoteMessagePortProxys: new Map<number, MessagePort>(),
    localFunctions: new WeakMap<Function, number>(),
    remoteFunctions: new Map<number, Function>()
  }) satisfies ConnectionContext
}


export const startConnection = (
  { platformCapabilities, context }:
  { platformCapabilities: PlatformCapabilities, context: ConnectionContext }
) => {
  const { uuid, remoteUuid, messagePort } = context

  messagePort.addEventListener('message', (event: MessageEvent<Message>) => {

  })
}

export type Connection = ReturnType<typeof startConnection>

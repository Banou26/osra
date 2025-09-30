import type { Capable, ConnectionMessage, Message, MessageContext, MessageVariant, Uuid } from '../types'
import type { PlatformCapabilities } from './capabilities'

export type ConnectionContext =
  | { type: 'bidirectional', messagePort: MessagePort, connection: BidirectionalConnection }
  | { type: 'unidirectional-emitting', connection: UnidirectionalEmittingConnection }
  | { type: 'unidirectional-receiving', messagePort: MessagePort, connection: UnidirectionalReceivingConnection }

export type BidirectionalConnectionContext = ConnectionContext & { type: 'bidirectional' }
export type UnidirectionalEmittingConnectionContext = ConnectionContext & { type: 'unidirectional-emitting' }
export type UnidirectionalReceivingConnectionContext = ConnectionContext & { type: 'unidirectional-receiving' }

export const startBidirectionalConnection = async (
  { value, uuid, remoteUuid, platformCapabilities, receiveMessagePort, send, close }:
  {
    value: Capable
    uuid: Uuid
    remoteUuid: Uuid
    platformCapabilities: PlatformCapabilities
    receiveMessagePort: MessagePort
    send: (message: ConnectionMessage) => void
    close: () => void
  }
) => {
  let initResolve: ((message: ConnectionMessage) => void)
  let initReject: ((reason?: any) => void)
  const initMessage = new Promise<ConnectionMessage>((resolve, reject) => {
    initResolve = resolve
    initReject = reject
  })

  receiveMessagePort.addEventListener('message', (event: MessageEvent<{ message: ConnectionMessage, messageContext: MessageContext }>) => {
    const { message, messageContext } = event.data
    if (message.type === 'init') {
      initResolve(message)
      return
    }
  })

  send({
    type: 'init',
    remoteUuid,
    data: value
  })

  return {
    remoteValue: await initMessage
  }
}

export type BidirectionalConnection = ReturnType<typeof startBidirectionalConnection>

export const startUnidirectionalEmittingConnection = <T extends Capable>(
  { value, uuid, platformCapabilities, send, close }:
  {
    value: Capable
    uuid: Uuid
    platformCapabilities: PlatformCapabilities
    send: (message: Message) => void
    close: () => void
  }
) => {

  return {
    proxy: new Proxy(
      new Function(),
      {
        apply: (target, thisArg, args) => {
        },
        get: (target, prop) => {
        }
      }
    ) as T
  }
}

export type UnidirectionalEmittingConnection = ReturnType<typeof startUnidirectionalEmittingConnection>

export const startUnidirectionalReceivingConnection = (
  { uuid, remoteUuid, platformCapabilities, close }:
  {
    uuid: Uuid
    remoteUuid?: Uuid
    platformCapabilities: PlatformCapabilities
    close: () => void
  }
) => {
  return {
    receiveMessage: (message: MessageVariant, messageContext: MessageContext) => {
    }
  }
}

export type UnidirectionalReceivingConnection = ReturnType<typeof startUnidirectionalReceivingConnection>

import type {
  Capable, ConnectionMessage,
  Message,
  Transport,
  Uuid
} from '../types'
import type { Allocator } from './allocator'
import type { PlatformCapabilities } from './capabilities'
import type { StrictMessagePort } from './message-channel'

import { recursiveBox, recursiveRevive } from './revivable'
import { makeAllocator } from './allocator'

export type BidirectionalConnectionContext = {
  type: 'bidirectional',
  messagePort: StrictMessagePort<Message>,
  connection: BidirectionalConnection
}
export type UnidirectionalEmittingConnectionContext = {
  type: 'unidirectional-emitting',
  connection: UnidirectionalEmittingConnection
}
export type UnidirectionalReceivingConnectionContext = {
  type: 'unidirectional-receiving',
  messagePort: StrictMessagePort<Message>,
  connection: UnidirectionalReceivingConnection
}

export type ConnectionContext =
  | BidirectionalConnectionContext
  | UnidirectionalEmittingConnectionContext
  | UnidirectionalReceivingConnectionContext

export type ConnectionRevivableContext = {
  transport: Transport
  remoteUuid: Uuid
  messagePorts: Allocator<MessagePort>
  sendMessage: (message: ConnectionMessage) => void
  receiveMessagePort: StrictMessagePort<Message>
}

export const startBidirectionalConnection = (
  { transport, value, uuid, remoteUuid, platformCapabilities, receiveMessagePort, send, close }:
  {
    transport: Transport
    value: Capable
    uuid: Uuid
    remoteUuid: Uuid
    platformCapabilities: PlatformCapabilities
    receiveMessagePort: StrictMessagePort<Message>
    send: (message: ConnectionMessage) => void
    close: () => void
  }
) => {
  const revivableContext = {
    transport,
    remoteUuid,
    messagePorts: makeAllocator(),
    sendMessage: send,
    receiveMessagePort
  } satisfies ConnectionRevivableContext
  let initResolve: ((message: ConnectionMessage & { type: 'init' }) => void)
  const initMessage = new Promise<ConnectionMessage & { type: 'init' }>((resolve, reject) => {
    initResolve = resolve
  })

  receiveMessagePort.addEventListener('message', (event) => {
    const message = event.data
    if (message.type === 'init') {
      initResolve(message)
      return
    }
  })
  receiveMessagePort.start()

  const boxed = recursiveBox(value, revivableContext)

  send({
    type: 'init',
    remoteUuid,
    data: boxed
  })

  return {
    close: () => {
    },
    remoteValue: initMessage.then(initMessage => recursiveRevive(initMessage.data, revivableContext))
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
    close: () => {
    },
    remoteValueProxy: new Proxy(
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
    receiveMessagePort: StrictMessagePort<Message>
    close: () => void
  }
) => {

  return {
    close: () => {
    },
  }
}

export type UnidirectionalReceivingConnection = ReturnType<typeof startUnidirectionalReceivingConnection>

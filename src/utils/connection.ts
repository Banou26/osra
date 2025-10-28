import type {
  Capable, ConnectionMessage,
  Message,
  MessageEventTarget,
  Transport,
  Uuid
} from '../types'
import type { Allocator } from './allocator'
import type { PlatformCapabilities } from './capabilities'
import type { StrictMessagePort } from './message-channel'

import { recursiveBox, recursiveRevive } from './revivable'
import { makeAllocator } from './allocator'

export type BidirectionalConnectionContext = {
  type: 'bidirectional'
  eventTarget: MessageEventTarget
  connection: BidirectionalConnection
}
export type UnidirectionalEmittingConnectionContext = {
  type: 'unidirectional-emitting'
  connection: UnidirectionalEmittingConnection
}
export type UnidirectionalReceivingConnectionContext = {
  type: 'unidirectional-receiving'
  eventTarget: MessageEventTarget
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
  eventTarget: MessageEventTarget
}

export type BidirectionalConnection<T extends Capable = Capable> = {
  close: () => void
  remoteValue: Promise<T>
}

export const startBidirectionalConnection = <T extends Capable>(
  { transport, value, uuid, remoteUuid, platformCapabilities, eventTarget, send, close }:
  {
    transport: Transport
    value: Capable
    uuid: Uuid
    remoteUuid: Uuid
    platformCapabilities: PlatformCapabilities
    eventTarget: MessageEventTarget
    send: (message: ConnectionMessage) => void
    close: () => void
  }
) => {
  const revivableContext = {
    transport,
    remoteUuid,
    messagePorts: makeAllocator(),
    sendMessage: send,
    eventTarget
  } satisfies ConnectionRevivableContext
  let initResolve: ((message: ConnectionMessage & { type: 'init' }) => void)
  const initMessage = new Promise<ConnectionMessage & { type: 'init' }>((resolve, reject) => {
    initResolve = resolve
  })

  eventTarget.addEventListener('message', (event) => {
    const message = event.detail
    if (message.type === 'init') {
      initResolve(message)
      return
    }
  })

  const boxed = recursiveBox(value, revivableContext)

  send({
    type: 'init',
    remoteUuid,
    data: boxed
  })

  return {
    close: () => {
    },
    remoteValue:
      initMessage
        .then(initMessage => recursiveRevive(initMessage.data, revivableContext)) as Promise<T>
  } satisfies BidirectionalConnection<T>
}

export type UnidirectionalEmittingConnection<T extends Capable = Capable> = {
  close: () => void
  remoteValueProxy: T
}

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

export type UnidirectionalReceivingConnection = {
  close: () => void
}

export const startUnidirectionalReceivingConnection = (
  { uuid, remoteUuid, platformCapabilities, close }:
  {
    uuid: Uuid
    remoteUuid?: Uuid
    platformCapabilities: PlatformCapabilities
    eventTarget: StrictMessagePort<Message>
    close: () => void
  }
) => {

  return {
    close: () => {
    }
  }
}

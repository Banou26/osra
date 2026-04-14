import type {
  Capable,
  Message,
  MessageEventTarget,
  Transport,
  Uuid
} from '../types'
import type { ConnectionMessage } from '../connections'
import type { MessageChannelAllocator } from './allocator'
import type { TypedEventPort } from './typed-message-channel'

import { makeMessageChannelAllocator } from './allocator'
import { DefaultRevivableModules, recursiveBox, recursiveRevive, RevivableModule } from '../revivables'
import { getTransferableObjects } from './transferable'

export type BidirectionalConnectionContext<
  TModules extends readonly RevivableModule[] = DefaultRevivableModules
> = {
  type: 'bidirectional'
  eventTarget: MessageEventTarget<TModules>
  connection: BidirectionalConnection
}
export type UnidirectionalEmittingConnectionContext = {
  type: 'unidirectional-emitting'
  connection: UnidirectionalEmittingConnection
}
export type UnidirectionalReceivingConnectionContext<
  TModules extends readonly RevivableModule[] = DefaultRevivableModules
> = {
  type: 'unidirectional-receiving'
  eventTarget: MessageEventTarget<TModules>
  connection: UnidirectionalReceivingConnection
}

export type ConnectionContext<
  TModules extends readonly RevivableModule[] = DefaultRevivableModules
> =
  | BidirectionalConnectionContext<TModules>
  | UnidirectionalEmittingConnectionContext
  | UnidirectionalReceivingConnectionContext<TModules>

export type ConnectionRevivableContext<TModules extends readonly RevivableModule[] = DefaultRevivableModules> = {
  transport: Transport
  remoteUuid: Uuid
  messagePorts: Set<MessagePort>
  messageChannels: MessageChannelAllocator
  sendMessage: (message: ConnectionMessage<TModules>) => void
  revivableModules: TModules
  eventTarget: MessageEventTarget<TModules>
}

export type BidirectionalConnection<T extends Capable = Capable> = {
  revivableContext: ConnectionRevivableContext<readonly RevivableModule[]>
  close: () => void
  remoteValue: Promise<T>
}

export const startBidirectionalConnection = <
  T extends Capable,
  TModules extends readonly RevivableModule[] = DefaultRevivableModules
>(
  { transport, value, uuid, remoteUuid, eventTarget, send, close, revivableModules }:
  {
    transport: Transport
    value: Capable
    uuid: Uuid
    remoteUuid: Uuid
    eventTarget: MessageEventTarget<TModules>
    send: (message: ConnectionMessage<TModules>) => void
    close: () => void
    revivableModules: TModules
  }
) => {
  const revivableContext = {
    transport,
    remoteUuid,
    messagePorts: new Set(),
    messageChannels: makeMessageChannelAllocator(),
    sendMessage: send,
    eventTarget,
    revivableModules
  } satisfies ConnectionRevivableContext<TModules>
  let initResolve: ((message: ConnectionMessage<TModules> & { type: 'init' }) => void)
  const initMessage = new Promise<ConnectionMessage<TModules> & { type: 'init' }>((resolve, reject) => {
    initResolve = resolve
  })

  eventTarget.addEventListener('message', ({ detail }) => {
    if (detail.type === 'init') {
      initResolve(detail)
      return
    } else if (detail.type === 'message') {
      const messageChannel = revivableContext.messageChannels.getOrAlloc(detail.portId)
      const transferables = getTransferableObjects(detail)
      ;(messageChannel.port2 as MessagePort)?.postMessage(detail, { transfer: transferables })
    }
  })

  send({
    type: 'init',
    remoteUuid,
    data: recursiveBox(value, revivableContext) as Capable
  })

  return {
    revivableContext,
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
  { value, uuid, send, close }:
  {
    value: Capable
    uuid: Uuid
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
  { uuid, remoteUuid, close }:
  {
    uuid: Uuid
    remoteUuid?: Uuid
    eventTarget: TypedEventPort<Message>
    close: () => void
  }
) => {

  return {
    close: () => {
    }
  }
}

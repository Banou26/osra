import type {
  Capable, ConnectionMessage,
  Message,
  MessageEventTarget,
  Transport,
  Uuid
} from '../types'
import type { MessageChannelAllocator } from './allocator'
import type { PlatformCapabilities } from './capabilities'
import type { StrictMessagePort } from './message-channel'

import { makeMessageChannelAllocator } from './allocator'
import { DefaultRevivableModules, recursiveBox, recursiveRevive, RevivableModule } from '../revivables'
import { getTransferableObjects } from './transferable'

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

export type ConnectionRevivableContext<TModules extends readonly RevivableModule[] = DefaultRevivableModules> = {
  platformCapabilities: PlatformCapabilities
  transport: Transport
  remoteUuid: Uuid
  messagePorts: Set<MessagePort>
  messageChannels: MessageChannelAllocator
  sendMessage: (message: ConnectionMessage) => void
  revivableModules: TModules
  eventTarget: MessageEventTarget
  // eslint-disable-next-line @typescript-eslint/ban-types
  outgoingFunctionIds: WeakMap<Function, Uuid>
  // eslint-disable-next-line @typescript-eslint/ban-types
  outgoingFunctionsById: Map<Uuid, WeakRef<Function>>
  // eslint-disable-next-line @typescript-eslint/ban-types
  revivedFunctionsById: Map<Uuid, WeakRef<Function>>
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
  { transport, value, uuid, remoteUuid, platformCapabilities, eventTarget, send, close, revivableModules }:
  {
    transport: Transport
    value: Capable
    uuid: Uuid
    remoteUuid: Uuid
    platformCapabilities: PlatformCapabilities
    eventTarget: MessageEventTarget
    send: (message: ConnectionMessage) => void
    close: () => void
    revivableModules: TModules
  }
) => {
  const revivableContext = {
    platformCapabilities,
    transport,
    remoteUuid,
    messagePorts: new Set(),
    messageChannels: makeMessageChannelAllocator(),
    sendMessage: send,
    eventTarget,
    revivableModules,
    // eslint-disable-next-line @typescript-eslint/ban-types
    outgoingFunctionIds: new WeakMap<Function, Uuid>(),
    // eslint-disable-next-line @typescript-eslint/ban-types
    outgoingFunctionsById: new Map<Uuid, WeakRef<Function>>(),
    // eslint-disable-next-line @typescript-eslint/ban-types
    revivedFunctionsById: new Map<Uuid, WeakRef<Function>>(),
  } satisfies ConnectionRevivableContext<TModules>
  let initResolve: ((message: ConnectionMessage & { type: 'init' }) => void)
  const initMessage = new Promise<ConnectionMessage & { type: 'init' }>((resolve, reject) => {
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
    } else if (detail.type === 'function-drop') {
      // The remote side's revived function proxy was garbage collected; evict
      // our outgoing identity entry so the next box of the same source
      // function allocates a fresh id and sends the full payload.
      const ref = revivableContext.outgoingFunctionsById.get(detail.id)
      const fn = ref?.deref()
      if (fn) revivableContext.outgoingFunctionIds.delete(fn)
      revivableContext.outgoingFunctionsById.delete(detail.id)
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

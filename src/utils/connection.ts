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
  outgoingIdentityIds: WeakMap<object, Uuid>
  outgoingIdentitiesById: Map<Uuid, WeakRef<object>>
  revivedIdentitiesById: Map<Uuid, WeakRef<object>>
  identityCleanupRegistry: FinalizationRegistry<Uuid>
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
  // Identity tables — populated only by the `identity` revivable. Declared
  // here so the cleanup FinalizationRegistry can close over them without
  // going through a per-entry held-value object.
  const outgoingIdentityIds = new WeakMap<object, Uuid>()
  const outgoingIdentitiesById = new Map<Uuid, WeakRef<object>>()
  const revivedIdentitiesById = new Map<Uuid, WeakRef<object>>()

  // Fires when a revived identity-wrapped value is GC'd. Evicts the local
  // cache entry and sends an `identity-drop` so the box side can evict its
  // outgoing entry. Held value is just the id — the callback closes over
  // the Map and `send` so there's no per-entry allocation.
  const identityCleanupRegistry = new FinalizationRegistry<Uuid>((id) => {
    revivedIdentitiesById.delete(id)
    try {
      send({ type: 'identity-drop', remoteUuid, id })
    } catch { /* Connection may already be torn down */ }
  })

  const revivableContext = {
    platformCapabilities,
    transport,
    remoteUuid,
    messagePorts: new Set(),
    messageChannels: makeMessageChannelAllocator(),
    sendMessage: send,
    eventTarget,
    revivableModules,
    outgoingIdentityIds,
    outgoingIdentitiesById,
    revivedIdentitiesById,
    identityCleanupRegistry,
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
    } else if (detail.type === 'identity-drop') {
      // The remote side's cached revived value for this id was GC'd; evict
      // our outgoing entry so the next box of the same wrapper allocates a
      // fresh id.
      const ref = outgoingIdentitiesById.get(detail.id)
      const wrapper = ref?.deref()
      if (wrapper) outgoingIdentityIds.delete(wrapper)
      outgoingIdentitiesById.delete(detail.id)
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

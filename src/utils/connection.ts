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
  outgoingValueIds: WeakMap<object, Uuid>
  outgoingValuesById: Map<Uuid, WeakRef<object>>
  revivedValuesById: Map<Uuid, WeakRef<object>>
  revivableCleanupRegistry: FinalizationRegistry<Uuid>
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
  // Identity tables — declared here so the FinalizationRegistry can close
  // over them without going through a per-entry held-value object (which
  // would allocate per-revive under heavy churn).
  const outgoingValueIds = new WeakMap<object, Uuid>()
  const outgoingValuesById = new Map<Uuid, WeakRef<object>>()
  const revivedValuesById = new Map<Uuid, WeakRef<object>>()

  // Revive-side cleanup: fires when a revived proxy is GC'd. Evicts the local
  // cache entry and sends a `revivable-drop` so the box side can evict its
  // outgoing entry. Held value is just the id string — the callback closes
  // over the locals above so there's no per-entry allocation.
  //
  // Box-side cleanup (sweeping dead WeakRefs from `outgoingValuesById` when
  // the source is GC'd on this side) is handled reactively through the
  // `revivable-drop` messages the other side sends when it drops its revived
  // proxy — adding a second sender-side FR on top of this doubled per-box
  // bookkeeping cost and pushed memory tests over their threshold under
  // heavy churn, without materially changing the steady-state leak profile.
  const revivableCleanupRegistry = new FinalizationRegistry<Uuid>((id) => {
    revivedValuesById.delete(id)
    try {
      send({ type: 'revivable-drop', remoteUuid, id })
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
    outgoingValueIds,
    outgoingValuesById,
    revivedValuesById,
    revivableCleanupRegistry,
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
    } else if (detail.type === 'revivable-drop') {
      // The remote side's revived proxy for this id was garbage collected;
      // evict our outgoing identity entry so the next box of the same source
      // value allocates a fresh id and sends the full payload.
      const ref = revivableContext.outgoingValuesById.get(detail.id)
      const source = ref?.deref()
      if (source) revivableContext.outgoingValueIds.delete(source)
      revivableContext.outgoingValuesById.delete(detail.id)
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

import type { Capable, Message, StructurableTransferable, Uuid } from '../types'
import type { TypedMessageChannel, TypedMessagePort } from '../utils/typed-message-channel'
import type { RevivableContext, BoxBase as BoxBaseType } from './utils'
import type { UnderlyingType } from '../utils/type'
import type {
  BadFieldValue, BadFieldPath, BadFieldParent,
  ErrorMessage, BadValue, Path, ParentObject
} from '../utils/capable-check'

import { BoxBase } from './utils'
import { recursiveBox, recursiveRevive } from '.'
import { OSRA_BOX } from '../types'
import { getTransferableObjects, isJsonOnlyTransport } from '../utils'
import { EventChannel, EventPort } from '../utils/event-channel'

/**
 * FinalizationRegistry for automatically cleaning up ports when they are garbage collected.
 * In JSON-only mode we can't transfer ports on the wire, so we track them via
 * portId and tell the remote side to close when the local handle is collected.
 */
type PortCleanupInfo = {
  sendMessage: (message: Messages) => void
  remoteUuid: Uuid
  portId: string
  cleanup: () => void
}

const messagePortRegistry = new FinalizationRegistry<PortCleanupInfo>((info) => {
  // Send close message to remote side
  info.sendMessage({
    type: 'message-port-close',
    remoteUuid: info.remoteUuid,
    portId: info.portId
  })
  // Perform local cleanup
  info.cleanup()
})

export const type = 'messagePort' as const

export type Messages =
  | {
    type: 'message'
    remoteUuid: Uuid
    data: Capable
    /** uuid of the messagePort that the message was sent through */
    portId: Uuid
  }
  | {
    type: 'message-port-close'
    remoteUuid: Uuid
    /** uuid of the messagePort that closed */
    portId: string
  }

export declare const Messages: Messages

/** Any port-shape the message-port revivable is happy to accept. Real
 *  MessagePorts (from `new MessageChannel()`) and synthetic EventPorts
 *  (from `new EventChannel()`) both flow through here. Messages can be any
 *  Capable value — message-port boxes/revives as they cross the transport,
 *  and the in-realm side uses pass-by-reference via EventChannel. */
export type AnyPort<T = Capable> =
  | TypedMessagePort<T>
  | EventPort<T>

export type BoxedMessagePort<T = Capable> =
  & BoxBaseType<typeof type>
  & ({ portId: string } | { port: AnyPort<T> })
  & { [UnderlyingType]: AnyPort<T> }

// `[T] extends [Capable]` disables distributive conditionals so unions like
// `A | B` give back `AnyPort<A | B>`, not `AnyPort<A> | AnyPort<B>`.
// The error branch intersects with AnyPort<T> so the user's port-shaped keys
// are present on the target — otherwise TS's excess-property check flags a
// port key instead of reporting the failure against the whole argument.
type StructurableTransferablePort<T> = [T] extends [Capable]
  ? AnyPort<T>
  : AnyPort<T> & {
      [ErrorMessage]: 'Message type must extend Capable'
      [BadValue]: BadFieldValue<T, Capable>
      [Path]: BadFieldPath<T, Capable>
      [ParentObject]: BadFieldParent<T, Capable>
    }

// -------------------------------------------------------------------------
// Per-connection message channel allocator
//
// Each bidirectional connection gets its own pool of local channels keyed
// by portId. These channels exist so JSON-only transports can emulate
// MessagePort semantics: when a message arrives for a given portId on the
// main transport, the connection routes it into the allocator's port2, and
// the revived user-facing port (port1 side) picks it up locally.
// -------------------------------------------------------------------------

type AllocatedMessageChannel<
  T extends StructurableTransferable = StructurableTransferable,
  T2 extends StructurableTransferable = StructurableTransferable
> = {
  uuid: Uuid
  /** Local port */
  port1: TypedMessagePort<T>
  /** Remote port that gets transferred, might be undefined if a remote context created the channel */
  port2?: TypedMessagePort<T2>
}

type MessageChannelAllocator = {
  getUniqueUuid: () => Uuid
  set: (uuid: Uuid, messagePorts: { port1: TypedMessagePort, port2?: TypedMessagePort }) => void
  alloc: (
    uuid?: Uuid,
    messagePorts?: { port1: TypedMessagePort, port2?: TypedMessagePort }
  ) => AllocatedMessageChannel
  has: (uuid: string) => boolean
  get: (uuid: string) => AllocatedMessageChannel | undefined
  free: (uuid: string) => boolean
  getOrAlloc: (
    uuid?: Uuid,
    messagePorts?: { port1: TypedMessagePort, port2?: TypedMessagePort }
  ) => AllocatedMessageChannel
}

const makeMessageChannelAllocator = (): MessageChannelAllocator => {
  const channels = new Map<string, AllocatedMessageChannel>()

  const result: MessageChannelAllocator = {
    getUniqueUuid: () => {
      let uuid: Uuid = globalThis.crypto.randomUUID()
      while (channels.has(uuid)) {
        uuid = globalThis.crypto.randomUUID()
      }
      return uuid
    },
    set: (uuid, messagePorts) => {
      channels.set(uuid, { uuid, ...messagePorts } as AllocatedMessageChannel)
    },
    alloc: (
      uuid: Uuid | undefined = result.getUniqueUuid(),
      messagePorts?: { port1: TypedMessagePort, port2?: TypedMessagePort }
    ) => {
      if (messagePorts) {
        const allocatedMessageChannel = { uuid, ...messagePorts } as AllocatedMessageChannel
        channels.set(uuid, allocatedMessageChannel)
        return allocatedMessageChannel
      }
      const messageChannel = new MessageChannel() as unknown as TypedMessageChannel
      const allocatedMessageChannel = {
        uuid,
        port1: messageChannel.port1,
        port2: messageChannel.port2
      } as AllocatedMessageChannel
      channels.set(uuid, allocatedMessageChannel)
      return allocatedMessageChannel
    },
    has: (uuid: string) => channels.has(uuid),
    get: (uuid: string) => channels.get(uuid),
    free: (uuid: string) => channels.delete(uuid),
    getOrAlloc: (
      uuid: Uuid | undefined = result.getUniqueUuid(),
      messagePorts?: { port1: TypedMessagePort, port2?: TypedMessagePort }
    ) => {
      const existingChannel = result.get(uuid)
      if (existingChannel) return existingChannel!
      return result.alloc(uuid, messagePorts)
    }
  }
  return result
}

// -------------------------------------------------------------------------
// Per-connection state
//
// The WeakMap ties per-connection message-port state to the connection's
// RevivableContext — when the context is collected, the allocator goes
// with it. State lives only here; no sibling revivable has to know about
// it.
// -------------------------------------------------------------------------

type ConnectionMessagePortState = {
  messageChannels: MessageChannelAllocator
}

const connectionStateMap = new WeakMap<RevivableContext, ConnectionMessagePortState>()

const getState = (context: RevivableContext): ConnectionMessagePortState => {
  const state = connectionStateMap.get(context)
  if (!state) {
    throw new Error('osra message-port: connection state missing; did init() run?')
  }
  return state
}

// -------------------------------------------------------------------------
// init hook
//
// Called once per connection by the bidirectional connection bootstrap.
// Sets up the per-connection allocator and installs the event-target
// listener that routes incoming 'message' envelopes to the correct local
// channel.
// -------------------------------------------------------------------------

export const init = (context: RevivableContext): void => {
  const state: ConnectionMessagePortState = {
    messageChannels: makeMessageChannelAllocator()
  }
  connectionStateMap.set(context, state)

  context.eventTarget.addEventListener('message', ({ detail }) => {
    if (detail.type !== 'message') return
    const messageChannel = state.messageChannels.getOrAlloc(detail.portId)
    const transferables = getTransferableObjects(detail)
    ;(messageChannel.port2 as unknown as MessagePort | undefined)?.postMessage(detail, { transfer: transferables })
  })
}

export const isType = (value: unknown): value is MessagePort | EventPort<StructurableTransferable> =>
  value instanceof MessagePort || value instanceof EventPort

export const box = <T, T2 extends RevivableContext = RevivableContext>(
  value: StructurableTransferablePort<T>,
  context: T2
) => {
  if (isJsonOnlyTransport(context.transport)) {
    const { messageChannels } = getState(context)
    const messagePort = value as unknown as AnyPort<T>
    // Only generate a unique UUID, don't store the port in the allocator.
    // Storing the port would create a strong reference that prevents GC and FinalizationRegistry cleanup.
    const portId = messageChannels.getUniqueUuid()

    // Use WeakRef to allow messagePort to be garbage collected.
    // The eventTargetListener would otherwise hold a strong reference preventing GC.
    const messagePortRef = new WeakRef(messagePort as object)

    // Incoming: remote side wrote to its revived port — deliver the payload
    // on our local port after reviving it back into a live value.
    const eventTargetListener = ({ detail: message }: CustomEvent<Message>) => {
      if (message.type === 'message-port-close') {
        if (message.portId !== portId) return
        messageChannels.free(portId)
        const port = messagePortRef.deref() as AnyPort<T> | undefined
        if (port) {
          // Unregister from FinalizationRegistry to prevent double-close
          messagePortRegistry.unregister(port as object)
          port.close()
        }
        context.eventTarget.removeEventListener('message', eventTargetListener)
        return
      }
      if (message.type !== 'message' || message.portId !== portId) return
      const port = messagePortRef.deref() as AnyPort<T> | undefined
      if (!port) {
        // Port was garbage collected, remove this listener
        context.eventTarget.removeEventListener('message', eventTargetListener)
        return
      }
      const revivedData = recursiveRevive(message.data, context) as T
      ;(port as EventPort<T>).postMessage(revivedData, getTransferableObjects(revivedData))
    }

    // Outgoing: whatever was written into our side of the user's channel gets
    // boxed and shipped over the main transport.
    function messagePortListener({ data }: MessageEvent) {
      context.sendMessage({
        type: 'message',
        remoteUuid: context.remoteUuid,
        data: recursiveBox(data as Capable, context) as Capable,
        portId
      })
    }

    const liveRef = messagePortRef.deref() as AnyPort<T> | undefined
    if (liveRef) {
      // Register for automatic cleanup when garbage collected.
      // Use the port itself as the unregister token.
      messagePortRegistry.register(liveRef as object, {
        sendMessage: context.sendMessage,
        remoteUuid: context.remoteUuid,
        portId,
        cleanup: () => {
          messageChannels.free(portId)
          context.eventTarget.removeEventListener('message', eventTargetListener)
          ;(messagePortRef.deref() as AnyPort<T> | undefined)
            ?.removeEventListener('message', messagePortListener as EventListener)
          ;(messagePortRef.deref() as AnyPort<T> | undefined)?.close()
        }
      }, liveRef as object)

      liveRef.addEventListener('message', messagePortListener as EventListener)
      liveRef.start()
    }

    context.eventTarget.addEventListener('message', eventTargetListener)

    const result = {
      ...BoxBase,
      type,
      portId
    }
    return result as typeof result & { [UnderlyingType]: AnyPort<T> }
  }
  const result = {
    ...BoxBase,
    type,
    port: value
  }
  return result as typeof result & { [UnderlyingType]: AnyPort<T> }
}

export const revive = <T extends Capable, T2 extends RevivableContext>(
  value: BoxedMessagePort<T>,
  context: T2
): EventPort<T> => {
  if ('portId' in value) {
    const { messageChannels } = getState(context)
    const { portId } = value
    // Use an EventChannel (pass-by-reference) rather than a real MessageChannel,
    // so reviving data with non-cloneable live values (Promises, Functions,
    // ReadableStreams, …) doesn't trip structured clone.
    const { port1: userPort, port2: internalPort } = new EventChannel<T, T>()

    const existingChannel = messageChannels.get(value.portId)
    const { port1 } =
      existingChannel
        ? existingChannel
        : messageChannels.alloc(value.portId as Uuid)
    const port1AsMessagePort = port1 as unknown as MessagePort

    const userPortRef = new WeakRef(userPort)

    const eventTargetListener = ({ detail: message }: CustomEvent<Message>) => {
      if (message.type !== 'message-port-close' || message.portId !== portId) return
      const port = userPortRef.deref()
      if (port) {
        // Unregister from FinalizationRegistry to prevent double-close
        messagePortRegistry.unregister(port)
      }
      performCleanup()
    }

    const port1Listener = ({ data: message }: MessageEvent) => {
      if (message.type !== 'message' || message.portId !== portId) return

      const port = userPortRef.deref()
      if (!port) {
        performCleanup()
        return
      }

      // Data on the wire is always boxed — revive and hand the live value to
      // the caller. No structured clone happens here because internalPort is
      // an EventPort (pass-by-ref), so live Promises/Functions etc. flow
      // through unchanged.
      const revivedData = recursiveRevive(message.data, context) as T
      internalPort.postMessage(revivedData)
    }

    // Outgoing: whatever the caller posted to userPort gets boxed and
    // shipped across the main transport.
    function internalPortListener({ data }: MessageEvent) {
      context.sendMessage({
        type: 'message',
        remoteUuid: context.remoteUuid,
        data: recursiveBox(data, context),
        portId: portId as Uuid
      })
    }

    const performCleanup = () => {
      context.eventTarget.removeEventListener('message', eventTargetListener)
      port1AsMessagePort.removeEventListener('message', port1Listener)
      internalPort.removeEventListener('message', internalPortListener)
      internalPort.close()
      // Close the allocator's MessageChannel ports before freeing
      const allocatedChannel = messageChannels.get(portId)
      if (allocatedChannel) {
        allocatedChannel.port1.close()
        if (allocatedChannel.port2) {
          allocatedChannel.port2.close()
        }
      }
      messageChannels.free(portId)
    }

    messagePortRegistry.register(userPort, {
      sendMessage: context.sendMessage,
      remoteUuid: context.remoteUuid,
      portId,
      cleanup: performCleanup
    }, userPort)

    internalPort.addEventListener('message', internalPortListener)
    internalPort.start()

    context.eventTarget.addEventListener('message', eventTargetListener)

    port1AsMessagePort.addEventListener('message', port1Listener)
    port1AsMessagePort.start()

    return userPort as unknown as EventPort<T>
  }
  return value.port as EventPort<T>
}

const typeCheck = () => {
  const port = new MessageChannel().port1 as unknown as TypedMessagePort<{ foo: string }>
  const boxed = box(port, {} as RevivableContext)
  const revived = revive(boxed, {} as RevivableContext)
  const expected: AnyPort<{ foo: string }> = revived
  // @ts-expect-error - wrong message type
  const wrongType: AnyPort<{ bar: number }> = revived
  // Promise-valued messages are fine now — EventChannel pass-by-reference
  // means we don't need StructurableTransferable here.
  box(new MessageChannel().port1 as unknown as TypedMessagePort<Promise<string>>, {} as RevivableContext)
}

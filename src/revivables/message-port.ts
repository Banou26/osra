import type { Capable, Message, StructurableTransferable, Uuid } from '../types'
import type { EventPort } from '../utils/event-channel'
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

/**
 * FinalizationRegistry for automatically cleaning up MessagePorts when they are garbage collected.
 * This is used in JSON-only mode where MessagePorts can't be transferred directly.
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
 *  (from `new EventChannel()`) both flow through here. */
export type AnyPort<T extends StructurableTransferable = StructurableTransferable> =
  | TypedMessagePort<T>
  | EventPort<T>

export type BoxedMessagePort<T extends StructurableTransferable = StructurableTransferable> =
  & BoxBaseType<typeof type>
  & ({ portId: string } | { port: AnyPort<T> })
  & { [UnderlyingType]: AnyPort<T> }

type StructurableTransferablePort<T> = T extends StructurableTransferable
  ? AnyPort<T>
  : {
      [ErrorMessage]: 'Message type must extend StructurableTransferable'
      [BadValue]: BadFieldValue<T, StructurableTransferable>
      [Path]: BadFieldPath<T, StructurableTransferable>
      [ParentObject]: BadFieldParent<T, StructurableTransferable>
    }

type ExtractStructurableTransferable<T> = T extends StructurableTransferable ? T : never

// -------------------------------------------------------------------------
// Per-connection message channel allocator
//
// Each bidirectional connection gets its own pool of local MessageChannels
// keyed by portId. These channels exist so JSON-only transports can emulate
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
// RevivableContext — when the context is collected, the allocator and the
// internal port set go with it.
// -------------------------------------------------------------------------

type ConnectionMessagePortState = {
  messageChannels: MessageChannelAllocator
  /** Internal ports owned by osra (e.g. the internal side of revived
   *  Promise/Function/ReadableStream/AbortSignal). Data flowing through
   *  these is proxied as-is without an extra box/revive pass. */
  messagePorts: Set<MessagePort>
}

const connectionStateMap = new WeakMap<RevivableContext, ConnectionMessagePortState>()

const getState = (context: RevivableContext): ConnectionMessagePortState => {
  const state = connectionStateMap.get(context)
  if (!state) {
    throw new Error('osra message-port: connection state missing; did init() run?')
  }
  return state
}

/**
 * Register an internal osra-owned MessagePort for this connection so the
 * message-port revive path knows to proxy messages through without re-boxing.
 * Called by revivables that create their own private MessageChannel
 * (Promise, Function, ReadableStream, AbortSignal).
 */
export const registerInternalPort = (context: RevivableContext, port: MessagePort): void => {
  getState(context).messagePorts.add(port)
}

/**
 * Counterpart to registerInternalPort — remove a port once its revivable no
 * longer needs to be proxied (e.g. after a Promise settled).
 */
export const unregisterInternalPort = (context: RevivableContext, port: MessagePort): void => {
  getState(context).messagePorts.delete(port)
}

// -------------------------------------------------------------------------
// init hook
//
// Called once per connection by the bidirectional connection bootstrap.
// Sets up the per-connection allocator + internal port set and installs the
// event-target listener that routes incoming 'message' envelopes to the
// correct local MessageChannel.
// -------------------------------------------------------------------------

export const init = (context: RevivableContext): void => {
  const state: ConnectionMessagePortState = {
    messageChannels: makeMessageChannelAllocator(),
    messagePorts: new Set()
  }
  connectionStateMap.set(context, state)

  context.eventTarget.addEventListener('message', ({ detail }) => {
    if (detail.type !== 'message') return
    const messageChannel = state.messageChannels.getOrAlloc(detail.portId)
    const transferables = getTransferableObjects(detail)
    ;(messageChannel.port2 as unknown as MessagePort | undefined)?.postMessage(detail, { transfer: transferables })
  })
}

export const isType = (value: unknown): value is MessagePort =>
  value instanceof MessagePort

const isAlreadyBoxed = (value: unknown): boolean =>
  value !== null &&
  typeof value === 'object' &&
  OSRA_BOX in value &&
  (value as Record<string, unknown>)[OSRA_BOX] === 'revivable'

export const box = <T, T2 extends RevivableContext = RevivableContext>(
  value: StructurableTransferablePort<T>,
  context: T2
) => {
  if (isJsonOnlyTransport(context.transport)) {
    const { messageChannels } = getState(context)
    const messagePort = value as unknown as AnyPort<ExtractStructurableTransferable<T>>
    // Only generate a unique UUID, don't store the port in the allocator.
    // Storing the port would create a strong reference that prevents GC and FinalizationRegistry cleanup.
    const portId = messageChannels.getUniqueUuid()

    // Use WeakRef to allow messagePort to be garbage collected.
    // The eventTargetListener would otherwise hold a strong reference preventing GC.
    const messagePortRef = new WeakRef(messagePort as object)

    // The ReceiveTransport received a message from the other side so we call it on our own side's MessagePort after reviving it
    // Define listener before registering with FinalizationRegistry so we can remove it in cleanup
    const eventTargetListener = ({ detail: message }: CustomEvent<Message>) => {
      if (message.type === 'message-port-close') {
        if (message.portId !== portId) return
        messageChannels.free(portId)
        const port = messagePortRef.deref() as AnyPort<ExtractStructurableTransferable<T>> | undefined
        if (port) {
          // Unregister from FinalizationRegistry to prevent double-close
          messagePortRegistry.unregister(port as object)
          port.close()
        }
        context.eventTarget.removeEventListener('message', eventTargetListener)
        return
      }
      if (message.type !== 'message' || message.portId !== portId) return
      const port = messagePortRef.deref() as AnyPort<ExtractStructurableTransferable<T>> | undefined
      if (!port) {
        // Port was garbage collected, remove this listener
        context.eventTarget.removeEventListener('message', eventTargetListener)
        return
      }
      port.postMessage(message.data as ExtractStructurableTransferable<T>, getTransferableObjects(message.data))
    }

    // Since we are in a boxed MessagePort, we want to send a message to the other side through the EmitTransport
    // Define this listener before registering so it can be removed in cleanup
    function messagePortListener({ data }: MessageEvent) {
      context.sendMessage({
        type: 'message',
        remoteUuid: context.remoteUuid,
        data: (isAlreadyBoxed(data) ? data : recursiveBox(data as Capable, context)) as Capable,
        portId
      })
    }

    const liveRef = messagePortRef.deref() as AnyPort<ExtractStructurableTransferable<T>> | undefined
    if (liveRef) {
      // Register the messagePort for automatic cleanup when garbage collected
      // Use messagePort itself as the unregister token
      messagePortRegistry.register(liveRef as object, {
        sendMessage: context.sendMessage,
        remoteUuid: context.remoteUuid,
        portId,
        cleanup: () => {
          messageChannels.free(portId)
          context.eventTarget.removeEventListener('message', eventTargetListener)
          ;(messagePortRef.deref() as AnyPort<ExtractStructurableTransferable<T>> | undefined)
            ?.removeEventListener('message', messagePortListener as EventListener)
          ;(messagePortRef.deref() as AnyPort<ExtractStructurableTransferable<T>> | undefined)?.close()
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
    return result as typeof result & { [UnderlyingType]: AnyPort<ExtractStructurableTransferable<T>> }
  }
  const result = {
    ...BoxBase,
    type,
    port: value
  }
  return result as typeof result & { [UnderlyingType]: AnyPort<ExtractStructurableTransferable<T>> }
}

export const revive = <T extends StructurableTransferable, T2 extends RevivableContext>(
  value: BoxedMessagePort<T>,
  context: T2
): AnyPort<T> => {
  if ('portId' in value) {
    const { messageChannels, messagePorts } = getState(context)
    const { portId } = value
    const { port1: userPort, port2: internalPort } = new MessageChannel()

    const existingChannel = messageChannels.get(value.portId)
    const { port1 } =
      existingChannel
        ? existingChannel
        : messageChannels.alloc(value.portId as Uuid)
    const port1AsMessagePort = port1 as unknown as MessagePort

    const userPortRef = new WeakRef(userPort)

    // Define all listeners before registering so they can be removed in cleanup
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
        // Port was garbage collected, cleanup
        performCleanup()
        return
      }

      // if the returned messagePort has been registered as internal message port, then we proxy the data without reviving it
      if (messagePorts.has(port)) {
        internalPort.postMessage(message.data)
      } else {
        // In this case, userPort is actually passed by the user of osra and we should revive all the message data
        const revivedData = recursiveRevive(message.data, context)
        internalPort.postMessage(revivedData, getTransferableObjects(revivedData))
      }
    }

    // Since we are in a boxed MessagePort, we want to send a message to the other side through the EmitTransport
    // Define this listener before performCleanup so it can be removed in cleanup
    function internalPortListener({ data }: MessageEvent) {
      context.sendMessage({
        type: 'message',
        remoteUuid: context.remoteUuid,
        data: isAlreadyBoxed(data) ? data : recursiveBox(data, context),
        portId: portId as Uuid
      })
    }

    const performCleanup = () => {
      context.eventTarget.removeEventListener('message', eventTargetListener)
      port1AsMessagePort.removeEventListener('message', port1Listener)
      internalPort.removeEventListener('message', internalPortListener)
      internalPort.close()
      // Close the allocator's MessageChannel ports before freeing
      // The allocator creates a MessageChannel with port1 and port2 - both must be closed
      const allocatedChannel = messageChannels.get(portId)
      if (allocatedChannel) {
        allocatedChannel.port1.close()
        if (allocatedChannel.port2) {
          allocatedChannel.port2.close()
        }
      }
      messageChannels.free(portId)
    }

    // Register the userPort for automatic cleanup when garbage collected
    // Use userPort itself as the unregister token
    messagePortRegistry.register(userPort, {
      sendMessage: context.sendMessage,
      remoteUuid: context.remoteUuid,
      portId,
      cleanup: performCleanup
    }, userPort)

    internalPort.addEventListener('message', internalPortListener)
    internalPort.start()

    // Listen for close messages from the remote side through the main event target
    context.eventTarget.addEventListener('message', eventTargetListener)

    // The ReceiveTransport received a message from the other side so we call it on our own side's MessagePort after reviving it
    port1AsMessagePort.addEventListener('message', port1Listener)
    port1AsMessagePort.start()

    return userPort as unknown as AnyPort<T>
  }
  return value.port as AnyPort<T>
}

const typeCheck = () => {
  const port = new MessageChannel().port1 as unknown as TypedMessagePort<{ foo: string }>
  const boxed = box(port, {} as RevivableContext)
  const revived = revive(boxed, {} as RevivableContext)
  const expected: AnyPort<{ foo: string }> = revived
  // @ts-expect-error - wrong message type
  const wrongType: AnyPort<{ bar: number }> = revived
  // @ts-expect-error - non-StructurableTransferable message type
  box(new MessageChannel().port1 as unknown as TypedMessagePort<Promise<string>>, {} as RevivableContext)
}

import type { Capable, StructurableTransferable, Uuid } from '../types'
import type { TypedMessagePort } from '../utils/typed-message-channel'
import type { RevivableContext, BoxBase as BoxBaseType } from './utils'
import type { UnderlyingType } from '../utils/type'
import type {
  BadFieldValue, BadFieldPath, BadFieldParent,
  ErrorMessage, BadValue, Path, ParentObject
} from '../utils/capable-check'

import { BoxBase } from './utils'
import { recursiveBox, recursiveRevive } from '.'
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
// Per-connection state
//
// The WeakMap ties per-connection message-port state to the connection's
// RevivableContext — when the context is collected, the state goes with it.
// State lives only here; no sibling revivable has to know about it.
// -------------------------------------------------------------------------

type ConnectionMessagePortState = {
  /** Direct per-portId dispatch — O(1) lookup avoids the O(N) addEventListener
   *  scan that was the bottleneck for tight-loop RPC traffic. */
  portHandlers: Map<string, (message: Messages) => void>
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
// Sets up the per-connection port-handler map and installs the event-target
// listener that routes incoming 'message' envelopes to the correct local
// handler.
// -------------------------------------------------------------------------

export const init = (context: RevivableContext): void => {
  const state: ConnectionMessagePortState = {
    portHandlers: new Map()
  }
  connectionStateMap.set(context, state)

  context.eventTarget.addEventListener('message', ({ detail }) => {
    if (detail.type !== 'message' && detail.type !== 'message-port-close') return
    state.portHandlers.get(detail.portId)?.(detail)
  })
}

export const isType = (value: unknown): value is MessagePort | EventPort<StructurableTransferable> =>
  value instanceof MessagePort || value instanceof EventPort

export const box = <T, T2 extends RevivableContext = RevivableContext>(
  value: StructurableTransferablePort<T>,
  context: T2
) => {
  // Synthetic EventPorts are not structured-clonable, so even when the
  // transport supports cloning we have to route them via portId — otherwise
  // sending the wrapping message would crash with DataCloneError.
  if (isJsonOnlyTransport(context.transport) || value instanceof EventPort) {
    const { portHandlers } = getState(context)
    const liveRef = value as unknown as AnyPort<T>
    const portId: Uuid = globalThis.crypto.randomUUID()

    let cleanedUp = false
    const performCleanup = () => {
      if (cleanedUp) return
      cleanedUp = true
      portHandlers.delete(portId)
      messagePortRegistry.unregister(liveRef as object)
      liveRef.removeEventListener('message', messagePortListener as EventListener)
    }

    // Incoming: remote side wrote to its revived port — deliver the payload
    // on our local port after reviving it back into a live value.
    const handler = (message: Messages) => {
      if (message.type === 'message-port-close') {
        performCleanup()
        liveRef.close()
        return
      }
      const revivedData = recursiveRevive(message.data, context) as T
      ;(liveRef as EventPort<T>).postMessage(revivedData, getTransferableObjects(revivedData))
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

    // Register for automatic cleanup when garbage collected. Note the handler
    // (stored in portHandlers) holds `liveRef` strongly via closure, so GC
    // will only fire once the Map entry is deleted (in performCleanup).
    messagePortRegistry.register(liveRef as object, {
      sendMessage: context.sendMessage,
      remoteUuid: context.remoteUuid,
      portId,
      cleanup: performCleanup
    }, liveRef as object)

    liveRef.addEventListener('message', messagePortListener as EventListener)
    liveRef.start()

    // For synthetic EventPorts, close() is how the owning side signals it's
    // done — wire it up so we tear down listeners and notify the remote.
    if (liveRef instanceof EventPort) {
      liveRef._onClose = () => {
        if (cleanedUp) return
        context.sendMessage({
          type: 'message-port-close',
          remoteUuid: context.remoteUuid,
          portId
        })
        performCleanup()
      }
    }

    portHandlers.set(portId, handler)

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
    const { portHandlers } = getState(context)
    const { portId } = value
    // Use an EventChannel (pass-by-reference) rather than a real MessageChannel,
    // so reviving data with non-cloneable live values (Promises, Functions,
    // ReadableStreams, …) doesn't trip structured clone.
    const { port1: userPort, port2: internalPort } = new EventChannel<T, T>()

    const userPortRef = new WeakRef(userPort)

    let cleanedUp = false

    const performCleanup = () => {
      if (cleanedUp) return
      cleanedUp = true
      portHandlers.delete(portId)
      internalPort.removeEventListener('message', internalPortListener)
      internalPort.close()
      const port = userPortRef.deref()
      if (port) messagePortRegistry.unregister(port)
    }

    const handler = (message: Messages) => {
      if (message.type === 'message-port-close') {
        performCleanup()
        const port = userPortRef.deref()
        port?.close()
        return
      }
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

    messagePortRegistry.register(userPort, {
      sendMessage: context.sendMessage,
      remoteUuid: context.remoteUuid,
      portId,
      cleanup: performCleanup
    }, userPort)

    // When the user explicitly closes userPort, tear down local listeners
    // and notify the remote side so it can do the same.
    userPort._onClose = () => {
      if (cleanedUp) return
      context.sendMessage({
        type: 'message-port-close',
        remoteUuid: context.remoteUuid,
        portId
      })
      performCleanup()
    }

    internalPort.addEventListener('message', internalPortListener)
    internalPort.start()

    portHandlers.set(portId, handler)

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

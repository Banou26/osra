import type { Capable, Uuid } from '../types'
import type { StrictMessagePort } from '../utils/message-channel'
import type { RevivableContext, BoxBase as BoxBaseType, UnderlyingType, CustomMessageEvent } from './utils'

import { BoxBase } from './utils'
import { recursiveBox, recursiveRevive } from '.'
import { getTransferableObjects, isJsonOnlyTransport, makeMessageChannelAllocator, MessageChannelAllocator } from '../utils'
import { CapableChannel } from '../utils/message-channel'

/**
 * FinalizationRegistry for automatically cleaning up MessagePorts when they
 * are garbage collected. Used in the tunneling path where the port can't be
 * transferred directly through the main transport.
 */
type PortCleanupInfo = {
  sendMessage: (message: Messages) => void
  remoteUuid: Uuid
  portId: string
  cleanup: () => void
}

const messagePortRegistry = new FinalizationRegistry<PortCleanupInfo>((info) => {
  info.sendMessage({
    type: 'message-port-close',
    remoteUuid: info.remoteUuid,
    portId: info.portId,
  })
  info.cleanup()
})

export const type = 'messagePort' as const

/**
 * Wire messages owned by this module. Flow through `context.sendMessage` and
 * are dispatched via the shared connection event target.
 */
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

export type BoxedMessagePort<T = unknown> =
  & BoxBaseType<typeof type>
  & ({ portId: string } | { port: StrictMessagePort<T> })
  & { [UnderlyingType]: StrictMessagePort<T> }

// ---------------------------------------------------------------------------
// Per-connection state — lives in a module-local WeakMap keyed by the
// RevivableContext. `init()` seeds it at the start of each connection and
// tears it down on unregisterSignal abort. Not on RevivableContext because
// it's internal to message-port and nothing else should know about it.
// ---------------------------------------------------------------------------

type ConnectionMessagePortState = {
  messageChannels: MessageChannelAllocator
}

const connectionStateMap = new WeakMap<RevivableContext, ConnectionMessagePortState>()

const getState = (context: RevivableContext): ConnectionMessagePortState => {
  const existing = connectionStateMap.get(context)
  if (existing) return existing
  const state: ConnectionMessagePortState = {
    messageChannels: makeMessageChannelAllocator(),
  }
  connectionStateMap.set(context, state)
  return state
}

export const init = (context: RevivableContext) => {
  const state = getState(context)
  // Single dispatcher on the shared event target: routes incoming
  // message-port wire messages to the per-portId allocator channel so
  // each box/revive only pays O(1) listener cost instead of O(N).
  const listener = (event: CustomMessageEvent) => {
    if (event.detail.type === 'message' || event.detail.type === 'message-port-close') {
      const channel = state.messageChannels.getOrAlloc(event.detail.portId as Uuid)
      channel.port2?.postMessage(event.detail, [])
    }
  }
  context.eventTarget.addEventListener('message', listener)
  context.unregisterSignal?.addEventListener('abort', () => {
    context.eventTarget.removeEventListener('message', listener)
    connectionStateMap.delete(context)
  }, { once: true })
}

export const isType = (value: unknown): value is MessagePort =>
  value instanceof MessagePort
  // No-serialize stubs aren't MessagePort instances but structurally satisfy
  // the subset we care about — accept them here too.
  || (
    value !== null
    && typeof value === 'object'
    && typeof (value as MessagePort).postMessage === 'function'
    && typeof (value as MessagePort).start === 'function'
    && typeof (value as MessagePort).close === 'function'
  )

export const box = <T, T2 extends RevivableContext = RevivableContext>(
  value: StrictMessagePort<T>,
  revivableContext: T2,
) => {
  // Tunnel in two cases:
  // - JSON-only transport (wire can't carry ports anyway)
  // - Value is a no-serialize stub, not a real MessagePort (can't be
  //   transferred through a capable-mode structured-clone transport).
  // Everything else — a real MessagePort on a capable transport — is
  // wrapped unchanged and transferred natively.
  const isRealMessagePort = value instanceof MessagePort
  const shouldTunnel = isJsonOnlyTransport(revivableContext.transport) || !isRealMessagePort
  if (shouldTunnel) {
    const state = getState(revivableContext)
    const messagePort = value
    const portId = globalThis.crypto.randomUUID()

    // Use WeakRef so the caller can still GC the port — without this, our
    // dispatcher listener would hold a strong ref and pin it forever.
    const messagePortRef = new WeakRef(messagePort)

    // Read inbound tunneled messages via the allocator channel for this
    // portId, NOT via revivableContext.eventTarget directly. Under heavy
    // load (e.g. thousands of function-call return ports) the shared event
    // target gets a listener per box, and dispatch becomes O(N). Allocator
    // channels are per-portId, so each box's listener only fires for its
    // own messages.
    const allocatorChannel = state.messageChannels.getOrAlloc(portId as Uuid)
    const inboundListener = ({ data: message }: MessageEvent) => {
      if (message.type === 'message-port-close') {
        if (message.portId !== portId) return
        performBoxCleanup()
        messagePortRef.deref()?.close()
        return
      }
      if (message.type !== 'message' || message.portId !== portId) return
      const port = messagePortRef.deref()
      if (!port) return
      // Always revive and hand the result to the wrapped port. Revivables
      // that use internal no-serialize stubs can safely receive real
      // Promises/Functions/etc. from the revive step because stubs pass by
      // reference. User-passed real ports still work because the public
      // contract for user-owned MessagePorts carries structured-cloneable
      // payloads only.
      const revived = recursiveRevive(message.data, revivableContext)
      port.postMessage(revived as T, getTransferableObjects(revived))
    }

    function messagePortListener({ data }: MessageEvent) {
      revivableContext.sendMessage({
        type: 'message',
        remoteUuid: revivableContext.remoteUuid,
        data: recursiveBox(data as Capable, revivableContext) as Capable,
        portId,
      })
    }

    let boxCleaned = false
    const performBoxCleanup = () => {
      if (boxCleaned) return
      boxCleaned = true
      const port = messagePortRef.deref()
      if (port) messagePortRegistry.unregister(port)
      // Immediate: inbound path + allocator (the memory concern).
      allocatorChannel.port1.removeEventListener('message', inboundListener)
      allocatorChannel.port1.close()
      allocatorChannel.port2?.close()
      state.messageChannels.free(portId)
      // Deferred: outbound listener removal + close signal. CapableChannel
      // delivers via queueMicrotask, so a postMessage() just before close()
      // has a pending microtask that must fire before we tear down the
      // listener or signal the remote. This microtask runs AFTER the
      // delivery microtask (FIFO ordering).
      queueMicrotask(() => {
        messagePortRef.deref()?.removeEventListener('message', messagePortListener)
        revivableContext.sendMessage({
          type: 'message-port-close',
          remoteUuid: revivableContext.remoteUuid,
          portId,
        })
      })
    }

    messagePortRegistry.register(messagePortRef.deref()!, {
      sendMessage: revivableContext.sendMessage,
      remoteUuid: revivableContext.remoteUuid,
      portId,
      cleanup: performBoxCleanup,
    }, messagePortRef.deref())

    // When the partner port closes, this port becomes orphaned.
    // Trigger tunnel cleanup — deferred so pending microtask deliveries
    // from the partner's last postMessage() land first.
    ;(messagePort as any).onorphaned = () => {
      queueMicrotask(() => {
        if (boxCleaned) return
        performBoxCleanup()
      })
    }

    messagePortRef.deref()?.addEventListener('message', messagePortListener)
    messagePortRef.deref()?.start()

    allocatorChannel.port1.addEventListener('message', inboundListener)
    allocatorChannel.port1.start()

    return {
      ...BoxBase,
      type,
      portId,
    } as BoxedMessagePort<T>
  }
  // Capable-mode transport can carry real MessagePorts natively — wrap the
  // port in the box unchanged and let the transport transfer it.
  return {
    ...BoxBase,
    type,
    port: value,
  } as BoxedMessagePort<T>
}

export const revive = <T, T2 extends RevivableContext>(
  value: BoxedMessagePort<T>,
  revivableContext: T2,
): StrictMessagePort<T> => {
  if ('portId' in value) {
    const state = getState(revivableContext)
    const { portId } = value
    // User-facing port pair — CapableChannel so the returned port can
    // accept arbitrary JS values (Promises, Functions, real MessagePorts)
    // without hitting structured clone. The revivables that consume this
    // port post raw values and read raw values; boxing/reviving happens
    // only at the tunnel boundary (internalPortListener / port1Listener).
    const { port1: userPort, port2: internalPort } = new CapableChannel<T, T>()

    const existingChannel = state.messageChannels.get(value.portId)
    const { port1 } = existingChannel ?? state.messageChannels.alloc(value.portId as Uuid)

    const userPortRef = new WeakRef(userPort)

    const port1Listener = ({ data: message }: MessageEvent) => {
      if (message.type === 'message-port-close' && message.portId === portId) {
        const port = userPortRef.deref()
        if (port) messagePortRegistry.unregister(port)
        performReviveCleanup()
        return
      }
      if (message.type !== 'message' || message.portId !== portId) return
      const port = userPortRef.deref()
      if (!port) {
        performReviveCleanup()
        return
      }
      // Always revive before posting. Target is the internal stub port, so
      // the revived value (which may contain Promises, real MessagePorts,
      // etc.) passes by reference through the stub to the user code.
      const revived = recursiveRevive(message.data, revivableContext)
      internalPort.postMessage(revived as T)
    }

    function internalPortListener({ data }: MessageEvent) {
      revivableContext.sendMessage({
        type: 'message',
        remoteUuid: revivableContext.remoteUuid,
        data: recursiveBox(data as Capable, revivableContext) as Capable,
        portId: portId as Uuid,
      })
    }

    let reviveCleaned = false
    const performReviveCleanup = () => {
      if (reviveCleaned) return
      reviveCleaned = true
      const port = userPortRef.deref()
      if (port) messagePortRegistry.unregister(port)
      // Immediate: inbound path + allocator (the memory concern).
      ;(port1 as MessagePort).removeEventListener('message', port1Listener)
      const allocatedChannel = state.messageChannels.get(portId)
      if (allocatedChannel) {
        allocatedChannel.port1.close()
        allocatedChannel.port2?.close()
      }
      state.messageChannels.free(portId)
      // Deferred: outbound (internalPort) teardown + close signal.
      // Same rationale as box side — pending microtask deliveries from
      // a postMessage() just before close() must land first.
      queueMicrotask(() => {
        internalPort.removeEventListener('message', internalPortListener)
        internalPort.close()
        revivableContext.sendMessage({
          type: 'message-port-close',
          remoteUuid: revivableContext.remoteUuid,
          portId,
        })
      })
    }

    messagePortRegistry.register(userPort, {
      sendMessage: revivableContext.sendMessage,
      remoteUuid: revivableContext.remoteUuid,
      portId,
      cleanup: performReviveCleanup,
    }, userPort)

    // When userPort closes, internalPort becomes orphaned.
    // Trigger tunnel cleanup — deferred so pending microtask deliveries
    // from the last postMessage() land first.
    ;(internalPort as any).onorphaned = () => {
      queueMicrotask(() => {
        if (reviveCleaned) return
        performReviveCleanup()
      })
    }

    internalPort.addEventListener('message', internalPortListener)
    internalPort.start()

    ;(port1 as MessagePort).addEventListener('message', port1Listener)
    ;(port1 as MessagePort).start()

    return userPort
  }
  return value.port
}

const typeCheck = () => {
  const port = new MessageChannel().port1 as StrictMessagePort<{ foo: string }>
  const boxed = box(port, {} as RevivableContext)
  const revived = revive(boxed, {} as RevivableContext)
  const expected: StrictMessagePort<{ foo: string }> = revived
  // @ts-expect-error - wrong message type
  const wrongType: StrictMessagePort<{ bar: number }> = revived
}

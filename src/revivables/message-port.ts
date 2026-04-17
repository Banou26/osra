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
  portId: Uuid
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
    portId: Uuid
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
  & (
    /** The origin was a synthetic EventPort — revive must reproduce an
     *  EventPort on the other side so live (non-clonable) Promises/Functions
     *  etc. can flow through by reference. */
    | { portId: Uuid, synthetic: true }
    /** The origin was a real MessagePort but the transport can't carry
     *  ports (JSON-only) — revive produces a real MessagePort proxy so the
     *  receiver sees it as if it had been transferred. Payloads must be
     *  structured-clonable; live (non-clonable) values nested in a
     *  user-level MessagePort aren't supported in this mode. */
    | { portId: Uuid, synthetic: false }
    /** The origin was a real MessagePort and the transport supports
     *  structured clone — the port is transferred on the wire. When
     *  `autoBox` is true, the revive side wraps it in a `ProtocolPort`
     *  that auto-boxes outgoing / auto-revives incoming payloads so
     *  live values (Promises/Functions) flow through unchanged. When
     *  `autoBox` is absent/false, the receiver gets the raw MessagePort
     *  with structured-clone semantics (used for user-owned ports). */
    | { port: AnyPort<T>, autoBox?: boolean }
  )
  & { [UnderlyingType]: TypedMessagePort<T> }

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
  context: T2,
  options?: { autoBox?: boolean },
): BoxedMessagePort<T> => {
  // Synthetic EventPorts are not structured-clonable, so even when the
  // transport supports cloning we have to route them via portId — otherwise
  // sending the wrapping message would crash with DataCloneError.
  const synthetic = value instanceof EventPort
  if (synthetic || isJsonOnlyTransport(context.transport)) {
    const { portHandlers } = getState(context)
    const liveRef: AnyPort<T> = value
    const portId: Uuid = globalThis.crypto.randomUUID()

    let cleanedUp = false
    const performCleanup = () => {
      if (cleanedUp) return
      cleanedUp = true
      portHandlers.delete(portId)
      messagePortRegistry.unregister(liveRef)
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
      liveRef.postMessage(revivedData, getTransferableObjects(revivedData))
    }

    // Outgoing: whatever was written into our side of the user's channel gets
    // boxed and shipped over the main transport.
    function messagePortListener({ data }: MessageEvent<Capable>) {
      context.sendMessage({
        type: 'message',
        remoteUuid: context.remoteUuid,
        data: recursiveBox(data, context),
        portId,
      })
    }

    // Register for automatic cleanup when garbage collected. Note the handler
    // (stored in portHandlers) holds `liveRef` strongly via closure, so GC
    // will only fire once the Map entry is deleted (in performCleanup).
    messagePortRegistry.register(liveRef, {
      sendMessage: context.sendMessage,
      remoteUuid: context.remoteUuid,
      portId,
      cleanup: performCleanup,
    }, liveRef)

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
          portId,
        })
        performCleanup()
      }
    }

    portHandlers.set(portId, handler)

    return { ...BoxBase, type, portId, synthetic } as BoxedMessagePort<T>
  }
  return {
    ...BoxBase,
    type,
    port: value,
    ...(options?.autoBox ? { autoBox: true } : {}),
  } as BoxedMessagePort<T>
}

export const revive = <T extends Capable, T2 extends RevivableContext>(
  value: BoxedMessagePort<T>,
  context: T2,
): TypedMessagePort<T> => {
  if ('port' in value) {
    // autoBox: box side was an internal protocol channel — wrap the
    // transferred MessagePort so outgoing/incoming payloads auto-box/revive
    // and live values (Promises/Functions) flow through unchanged.
    if (value.autoBox) {
      return new ProtocolPort<T>(
        value.port as TypedMessagePort<Capable>, context,
      ) as unknown as TypedMessagePort<T>
    }
    return value.port
  }
  // portId path: origin was either a synthetic EventPort (pass-by-ref for
  // live values) or a real MessagePort we couldn't clone (JSON-only
  // transport). EventPorts must revive as EventPorts so that live values
  // pass through unchanged; MessagePorts must revive as MessagePorts so
  // the receiver sees the same shape they'd get from a real `transfer`.
  return reviveViaPortId<T>(value.portId, context, value.synthetic)
}

/**
 * Thin wrapper around a real MessagePort: auto-boxes outgoing messages and
 * auto-revives incoming ones. Lets revivables treat it like an EventTarget
 * (addEventListener / postMessage / start / close) that transparently
 * carries live values (Promises, Functions, …) over a clone-only transport.
 */
class ProtocolPort<T> extends EventTarget {
  constructor(
    private _port: TypedMessagePort<Capable>,
    private _ctx: RevivableContext,
  ) {
    super()
    _port.addEventListener('message', this._onMsg)
  }

  private _onMsg = ({ data }: MessageEvent<Capable>): void => {
    this.dispatchEvent(new MessageEvent('message', {
      data: recursiveRevive(data, this._ctx),
    }))
  }

  postMessage(data: T, opt?: Transferable[] | StructuredSerializeOptions): void {
    const extra = Array.isArray(opt) ? opt : []
    const boxed = recursiveBox(data as Capable, this._ctx)
    this._port.postMessage(boxed, [...getTransferableObjects(boxed), ...extra])
  }

  start(): void { this._port.start() }

  close(): void {
    this._port.removeEventListener('message', this._onMsg)
    this._port.close()
  }
}

/**
 * Factory for revivable-internal channels. Returns a local port used by the
 * revivable and a pre-boxed remote port ready to embed in the revivable's
 * Boxed* structure. The local port auto-boxes/revives on clone transports
 * (via ProtocolPort over a MessageChannel) and passes by reference on JSON
 * transports (via EventChannel → portId routing).
 *
 * Revivables can post live values (Promises/Functions/…) on `localPort`
 * without caring about the transport mode.
 */
export const createRevivableChannel = <T extends Capable>(
  context: RevivableContext,
): { localPort: AnyPort<T>, boxedRemote: BoxedMessagePort<T> } => {
  if (isJsonOnlyTransport(context.transport)) {
    const { port1, port2 } = new EventChannel<T, T>()
    return {
      localPort: port1,
      boxedRemote: box(port2 as StructurableTransferablePort<T>, context),
    }
  }
  const { port1, port2 } = new MessageChannel() as unknown as {
    port1: TypedMessagePort<Capable>
    port2: TypedMessagePort<Capable>
  }
  return {
    localPort: new ProtocolPort<T>(port1, context) as unknown as AnyPort<T>,
    boxedRemote: box(port2 as unknown as StructurableTransferablePort<T>, context, { autoBox: true }),
  }
}

/**
 * Revive a port that was routed via portId. Covers both the synthetic
 * (EventChannel, pass-by-reference) and proxy (real MessageChannel,
 * structured-clone) paths — they share all cleanup/routing logic, only
 * differing in which channel type is instantiated, whether transferables
 * are listed on internal postMessage, and whether userPort exposes an
 * explicit close hook.
 */
const reviveViaPortId = <T extends Capable>(
  portId: Uuid,
  context: RevivableContext,
  synthetic: boolean,
): TypedMessagePort<T> => {
  const { portHandlers } = getState(context)
  const { port1: userPort, port2: internalPort } =
    synthetic
      ? new EventChannel<T, T>()
      : new MessageChannel() as { port1: TypedMessagePort<T>, port2: TypedMessagePort<T> }
  const userPortRef = new WeakRef(userPort)

  let cleanedUp = false
  const performCleanup = () => {
    if (cleanedUp) return
    cleanedUp = true
    portHandlers.delete(portId)
    internalPort.removeEventListener('message', internalPortListener as EventListener)
    internalPort.close()
    const port = userPortRef.deref()
    if (port) messagePortRegistry.unregister(port)
  }

  const handler = (message: Messages) => {
    if (message.type === 'message-port-close') {
      performCleanup()
      userPortRef.deref()?.close()
      return
    }
    const port = userPortRef.deref()
    if (!port) {
      performCleanup()
      return
    }
    const revivedData = recursiveRevive(message.data, context) as T
    // Real MessagePorts need must-transfer items on the transfer list;
    // EventPorts pass by reference so no transferable list applies.
    if (synthetic) internalPort.postMessage(revivedData)
    else internalPort.postMessage(revivedData, getTransferableObjects(revivedData))
  }

  const internalPortListener = ({ data }: MessageEvent<T>) => {
    context.sendMessage({
      type: 'message',
      remoteUuid: context.remoteUuid,
      data: recursiveBox(data, context),
      portId,
    })
  }

  messagePortRegistry.register(userPort, {
    sendMessage: context.sendMessage,
    remoteUuid: context.remoteUuid,
    portId,
    cleanup: performCleanup,
  }, userPort)

  // EventPort exposes an explicit close hook — wire it so user.close() tears
  // down listeners locally and notifies the remote side. Real MessagePorts
  // have no equivalent; they rely on the FinalizationRegistry to notify.
  if (userPort instanceof EventPort) {
    userPort._onClose = () => {
      if (cleanedUp) return
      context.sendMessage({
        type: 'message-port-close',
        remoteUuid: context.remoteUuid,
        portId,
      })
      performCleanup()
    }
  }

  internalPort.addEventListener('message', internalPortListener as EventListener)
  internalPort.start()

  portHandlers.set(portId, handler)

  return userPort
}

const typeCheck = () => {
  const port = {} as TypedMessagePort<{ foo: string }>
  const boxed = box(port, {} as RevivableContext)
  const revived = revive(boxed, {} as RevivableContext)
  const expected: AnyPort<{ foo: string }> = revived
  // @ts-expect-error - wrong message type
  const wrongType: AnyPort<{ bar: number }> = revived
  // Promise-valued messages are fine now — EventChannel pass-by-reference
  // means we don't need StructurableTransferable here.
  box({} as TypedMessagePort<Promise<string>>, {} as RevivableContext)
}

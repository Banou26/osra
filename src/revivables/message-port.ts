import type { Capable, StructurableTransferable, Uuid } from '../types.js'
import type { TypedMessageChannel, TypedMessagePort } from '../utils/typed-message-channel.js'
import type { RevivableContext, BoxBase as BoxBaseType } from './utils.js'
import type { UnderlyingType } from '../utils/type.js'
import type {
  BadFieldValue, BadFieldPath, BadFieldParent,
  ErrorMessage, BadValue, Path, ParentObject
} from '../utils/capable-check.js'

import { BoxBase } from './utils.js'
import { recursiveBox, recursiveRevive } from './index.js'
import { getTransferableObjects } from '../utils/transferable.js'
import { isJsonOnlyTransport } from '../utils/type-guards.js'
import { EventChannel, EventPort } from '../utils/event-channel.js'
import { trackGc } from '../utils/gc-tracker.js'
import { onTeardown } from '../utils/teardown.js'

export const type = 'messagePort' as const

export type Messages =
  | { type: 'message', remoteUuid: Uuid, data: Capable, portId: Uuid, seq?: number }
  | { type: 'message-port-close', remoteUuid: Uuid, portId: Uuid, seq?: number }

export declare const Messages: Messages

export type AnyPort<T = Capable> =
  | TypedMessagePort<T>
  | EventPort<T>

export type BoxedMessagePort<T = Capable> =
  & BoxBaseType<typeof type>
  & (
    | { portId: Uuid, synthetic: true }
    | { portId: Uuid, synthetic: false }
    | { port: AnyPort<T>, autoBox?: boolean }
  )
  & { [UnderlyingType]: TypedMessagePort<T> }

// `[T] extends [Capable]` disables distributive conditionals so `A | B` gives
// back `AnyPort<A | B>`, not `AnyPort<A> | AnyPort<B>`. The error branch
// intersects with AnyPort<T> so excess-property check targets the failure
// rather than the user's port-shaped keys.
type StructurableTransferablePort<T> = [T] extends [Capable]
  ? AnyPort<T>
  : AnyPort<T> & {
      [ErrorMessage]: 'Message type must extend Capable'
      [BadValue]: BadFieldValue<T, Capable>
      [Path]: BadFieldPath<T, Capable>
      [ParentObject]: BadFieldParent<T, Capable>
    }

// Per-port routing. A connectionless transport (e.g. runtime.sendMessage) gives no
// ordering guarantee: a port's messages can arrive out of order, and even before the
// message that revives the port (registering its handler). Each side stamps its outgoing
// port messages with a monotonic `seq`; the receiver buffers by seq and delivers strictly
// in send-order once a handler exists. So neither reordering nor early arrival can drop or
// misorder a port's stream - which the credit-window readable-stream protocol relies on.
type PortRouting = {
  handler?: (message: Messages) => void
  /** Next incoming seq to deliver. */
  nextSeq: number
  /** Out-of-order / early incoming messages, keyed by their seq. */
  buffer: Map<number, Messages>
  /** Next outgoing seq to stamp on this side's messages for the port. */
  outSeq: number
}

// Cap the per-port reorder buffer so a peer that never sends the awaited seq can't grow
// it without bound; overflow fails the port closed instead of wedging it silently.
const REORDER_LIMIT = 2048
// Closed portIds remembered so late in-flight messages can't resurrect routing state.
const TOMBSTONE_LIMIT = 128
// Cap routing entries allocated by messages arriving before their port's handler registers.
const PENDING_PORT_LIMIT = 1024

type ConnectionMessagePortState = {
  /** O(1) per-portId routing - avoids the O(N) addEventListener scan that was the
   *  bottleneck for tight-loop RPC traffic. */
  ports: Map<string, PortRouting>
  /** Recently closed portIds, insertion-ordered for bounded eviction. */
  tombstones: Set<string>
  /** Count of handler-less entries in `ports`. */
  pendingPorts: number
}

const connectionStateMap = new WeakMap<RevivableContext, ConnectionMessagePortState>()

const getState = (context: RevivableContext): ConnectionMessagePortState => {
  const state = connectionStateMap.get(context)
  if (!state) throw new Error('osra message-port: connection state missing; did init() run?')
  return state
}

const getPort = (state: ConnectionMessagePortState, portId: string): PortRouting => {
  let port = state.ports.get(portId)
  if (!port) {
    port = { nextSeq: 0, buffer: new Map(), outSeq: 0 }
    state.ports.set(portId, port)
    state.pendingPorts++
  }
  return port
}

const tombstonePort = (state: ConnectionMessagePortState, portId: string): void => {
  const port = state.ports.get(portId)
  if (port && !port.handler) state.pendingPorts--
  state.ports.delete(portId)
  if (state.tombstones.size >= TOMBSTONE_LIMIT) {
    const oldest = state.tombstones.values().next().value
    if (oldest !== undefined) state.tombstones.delete(oldest)
  }
  state.tombstones.add(portId)
}

// Deliver buffered messages along the contiguous seq run, once a handler exists.
const drainPort = (port: PortRouting): void => {
  if (!port.handler) return
  for (let next = port.buffer.get(port.nextSeq); next !== undefined; next = port.buffer.get(port.nextSeq)) {
    port.buffer.delete(port.nextSeq)
    port.nextSeq++
    port.handler(next)
  }
}

// Next outgoing seq for a port (monotonic per sending side).
const nextOutSeq = (context: RevivableContext, portId: Uuid): number => getPort(getState(context), portId).outSeq++

const registerPortHandler = (
  context: RevivableContext,
  portId: Uuid,
  handler: (message: Messages) => void,
): void => {
  const state = getState(context)
  if (state.tombstones.has(portId)) {
    // Deferred so a listener attached right after revive still observes the close.
    queueMicrotask(() => handler({ type: 'message-port-close', remoteUuid: context.remoteUuid, portId }))
    return
  }
  const port = getPort(state, portId)
  if (!port.handler) state.pendingPorts--
  port.handler = handler
  drainPort(port)
}

export const init = (context: RevivableContext): void => {
  const state: ConnectionMessagePortState = { ports: new Map(), tombstones: new Set(), pendingPorts: 0 }
  connectionStateMap.set(context, state)

  context.eventTarget.addEventListener('message', ({ detail }) => {
    if (detail.type !== 'message' && detail.type !== 'message-port-close') return
    if (state.tombstones.has(detail.portId)) return
    let port = state.ports.get(detail.portId)
    // Legacy peer (osra <= 0.5.6) doesn't stamp seq - its transport was assumed ordered,
    // so deliver in arrival order; only seq-stamped messages are reordered.
    if (detail.seq === undefined) { port?.handler?.(detail); return }
    if (!port) {
      if (state.pendingPorts >= PENDING_PORT_LIMIT) return
      port = getPort(state, detail.portId)
    }
    if (detail.seq < port.nextSeq) return
    if (port.buffer.size >= REORDER_LIMIT && !(detail.seq === port.nextSeq && port.handler)) {
      // A full buffer whose gap can't close is unrecoverable - fail the port closed.
      port.buffer.clear()
      tombstonePort(state, detail.portId)
      port.handler?.({ type: 'message-port-close', remoteUuid: context.remoteUuid, portId: detail.portId })
      return
    }
    port.buffer.set(detail.seq, detail)
    drainPort(port)
  })

  // Connection death = every routed port is dead: run each handler's close
  // arm so user-facing ports close and routing entries clear.
  onTeardown(context, () => {
    for (const [portId, port] of [...state.ports]) {
      port.handler?.({ type: 'message-port-close', remoteUuid: context.remoteUuid, portId: portId as Uuid })
    }
    state.ports.clear()
    state.tombstones.clear()
    state.pendingPorts = 0
  })
}

export const isType = (value: unknown): value is MessagePort | EventPort<StructurableTransferable> =>
  value instanceof MessagePort || value instanceof EventPort

const sendClose = (context: RevivableContext, portId: Uuid) => {
  try {
    // Stamp the close with the next seq so it's ordered after this side's data messages
    // (a close that overtakes trailing data would drop it); a missing entry means the
    // port is already torn down, so read without resurrecting routing state.
    const port = getState(context).ports.get(portId)
    context.sendMessage({ type: 'message-port-close', remoteUuid: context.remoteUuid, portId, seq: port ? port.outSeq++ : 0 })
  } catch { /* connection torn down */ }
}

const postRevived = <T>(port: AnyPort<T>, data: T, synthetic: boolean) => {
  if (synthetic) port.postMessage(data)
  else port.postMessage(data, getTransferableObjects(data))
}

// Built in its own scope so the FR-held closure can't share box()'s
// environment record and transitively pin context/liveRef/handlers - the
// gc-tracker contract. By the time it fires both derefs are usually dead;
// its job is to not retain anything, so abandoned connections can collect.
const makeBoxGcNet = (
  contextWeak: WeakRef<RevivableContext>,
  stateWeak: WeakRef<ConnectionMessagePortState>,
  portId: Uuid,
) => () => {
  const ctx = contextWeak.deref()
  if (ctx) sendClose(ctx, portId)
  const state = stateWeak.deref()
  if (state) tombstonePort(state, portId)
}

export const box = <T, T2 extends RevivableContext = RevivableContext>(
  value: StructurableTransferablePort<T>,
  context: T2,
  options?: { autoBox?: boolean },
): BoxedMessagePort<T> => {
  // Synthetic EventPorts aren't structured-clonable, so even on a clone
  // transport we route them via portId.
  const synthetic = value instanceof EventPort
  if (!synthetic && !isJsonOnlyTransport(context.transport)) {
    return {
      ...BoxBase, type, port: value,
      ...(options?.autoBox ? { autoBox: true } : {}),
    } as BoxedMessagePort<T>
  }

  const state = getState(context)
  const liveRef: AnyPort<T> = value
  const portId: Uuid = globalThis.crypto.randomUUID()

  // The FR-held cleanup must not (transitively) strong-hold liveRef or the
  // context - the gc-tracker contract - or the registry pins them forever
  // and the safety net can never fire.
  const liveRefWeak = new WeakRef(liveRef)
  const contextWeak = new WeakRef(context)
  const stateWeak = new WeakRef(state)

  let cleanedUp = false
  const performCleanup = () => {
    if (cleanedUp) return
    cleanedUp = true
    const st = stateWeak.deref()
    if (st) tombstonePort(st, portId)
    unregisterGc?.()
    const live = liveRefWeak.deref()
    live?.removeEventListener('message', outgoingListener as EventListener)
    if (live instanceof EventPort) live._onClose = undefined
  }

  const handler = (message: Messages) => {
    if (message.type === 'message-port-close') {
      performCleanup()
      // Peer side closed - surface the platform 'close' event before closing.
      liveRef.dispatchEvent(new Event('close'))
      liveRef.close()
      return
    }
    postRevived(liveRef, recursiveRevive(message.data, context) as T, false)
  }

  function outgoingListener({ data }: MessageEvent<Capable>) {
    context.sendMessage({
      type: 'message',
      remoteUuid: context.remoteUuid,
      data: recursiveBox(data, context),
      portId,
      seq: nextOutSeq(context, portId),
    })
  }

  // Safety net only - `handler` strong-holds liveRef via portHandlers, so
  // the FR won't fire while the connection is alive. Real cleanup runs via
  // the wire `message-port-close`, EventPort `_onClose`, or teardown.
  const unregisterGc = trackGc(liveRef, makeBoxGcNet(contextWeak, stateWeak, portId))

  liveRef.addEventListener('message', outgoingListener as EventListener)
  liveRef.start()

  if (liveRef instanceof EventPort) {
    liveRef._onClose = () => {
      if (cleanedUp) return
      sendClose(context, portId)
      performCleanup()
    }
  }

  registerPortHandler(context, portId, handler)

  return { ...BoxBase, type, portId, synthetic } as BoxedMessagePort<T>
}

export const revive = <T extends Capable, T2 extends RevivableContext>(
  value: BoxedMessagePort<T>,
  context: T2,
): TypedMessagePort<T> => {
  if ('port' in value) {
    if (value.autoBox) return createProtocolPort<T>(value.port as TypedMessagePort<Capable>, context)
    return value.port
  }
  return reviveViaPortId<T>(value.portId, context, value.synthetic)
}

/** Wraps a real MessagePort so revivables can treat it like a transparent
 *  EventTarget that auto-boxes/revives - letting live values (Promises,
 *  Functions, …) ride a clone-only transport. */
const createProtocolPort = <T>(
  port: TypedMessagePort<Capable>,
  ctx: RevivableContext,
): TypedMessagePort<T> => {
  const target = new EventTarget() as TypedMessagePort<T>
  const onMessage = ({ data }: MessageEvent<Capable>): void => {
    target.dispatchEvent(new MessageEvent('message', { data: recursiveRevive(data, ctx) }))
  }
  // Modern browsers fire 'close' on a MessagePort when its entangled peer
  // closes or its realm dies - forward it so consumers can clean up.
  const onClose = (): void => {
    target.dispatchEvent(new Event('close'))
  }
  port.addEventListener('message', onMessage)
  port.addEventListener('close', onClose as EventListener)
  target.postMessage = (data: T, opt?: Transferable[] | StructuredSerializeOptions) => {
    const boxed = recursiveBox(data as Capable, ctx)
    const transferables = getTransferableObjects(boxed)
    const extra = Array.isArray(opt) ? opt : []
    port.postMessage(boxed, extra.length ? [...transferables, ...extra] : transferables)
  }
  target.start = () => port.start()
  target.close = () => {
    port.removeEventListener('message', onMessage)
    port.removeEventListener('close', onClose as EventListener)
    port.close()
  }
  return target
}

/** Factory for revivable-internal channels. Returns a local port that
 *  auto-boxes live values regardless of transport, plus a pre-boxed remote
 *  port the revivable embeds in its Boxed* structure. */
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
  const { port1, port2 } = new MessageChannel() as unknown as TypedMessageChannel<Capable, Capable>
  return {
    localPort: createProtocolPort<T>(port1, context) as unknown as AnyPort<T>,
    boxedRemote: box(port2 as unknown as StructurableTransferablePort<T>, context, { autoBox: true }),
  }
}

const reviveViaPortId = <T extends Capable>(
  portId: Uuid,
  context: RevivableContext,
  synthetic: boolean,
): TypedMessagePort<T> => {
  const state = getState(context)
  const { port1: userPort, port2: internalPort } =
    synthetic
      ? new EventChannel<T, T>()
      : new MessageChannel() as unknown as TypedMessageChannel<T, T>
  const userPortRef = new WeakRef(userPort)
  // For synthetic EventChannels, internalPort._peer === userPort - holding
  // internalPort strongly from the trackGc cleanup would re-pin userPort.
  const internalPortRef = new WeakRef(internalPort)

  let cleanedUp = false
  const performCleanup = () => {
    if (cleanedUp) return
    cleanedUp = true
    tombstonePort(state, portId)
    const internal = internalPortRef.deref()
    internal?.removeEventListener('message', internalPortListener as EventListener)
    internal?.close()
    unregisterGc?.()
  }

  const handler = (message: Messages) => {
    if (message.type === 'message-port-close') {
      performCleanup()
      const user = userPortRef.deref()
      // Peer side closed - surface the platform 'close' event before closing.
      user?.dispatchEvent(new Event('close'))
      user?.close()
      return
    }
    if (!userPortRef.deref()) {
      performCleanup()
      return
    }
    const internal = internalPortRef.deref()
    if (!internal) return
    postRevived(internal, recursiveRevive(message.data, context) as T, synthetic)
  }

  const internalPortListener = ({ data }: MessageEvent<T>) => {
    context.sendMessage({
      type: 'message',
      remoteUuid: context.remoteUuid,
      data: recursiveBox(data, context),
      portId,
      seq: nextOutSeq(context, portId),
    })
  }

  const unregisterGc = trackGc(userPort, () => {
    sendClose(context, portId)
    performCleanup()
  })

  if (userPort instanceof EventPort) {
    userPort._onClose = () => {
      if (cleanedUp) return
      sendClose(context, portId)
      performCleanup()
    }
  }

  internalPort.addEventListener('message', internalPortListener as EventListener)
  internalPort.start()

  registerPortHandler(context, portId, handler)

  return userPort
}

const typeCheck = () => {
  const port = {} as TypedMessagePort<{ foo: string }>
  const boxed = box(port, {} as RevivableContext)
  const revived = revive(boxed, {} as RevivableContext)
  const expected: AnyPort<{ foo: string }> = revived
  // @ts-expect-error - wrong message type
  const wrongType: AnyPort<{ bar: number }> = revived
  box({} as TypedMessagePort<Promise<string>>, {} as RevivableContext)
}

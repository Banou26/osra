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
import { trackGc } from '../utils/gc-tracker'

export const type = 'messagePort' as const

export type Messages =
  | { type: 'message', remoteUuid: Uuid, data: Capable, portId: Uuid }
  | { type: 'message-port-close', remoteUuid: Uuid, portId: Uuid }

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

type ConnectionMessagePortState = {
  /** O(1) per-portId dispatch — avoids the O(N) addEventListener scan
   *  that was the bottleneck for tight-loop RPC traffic. */
  portHandlers: Map<string, (message: Messages) => void>
}

const connectionStateMap = new WeakMap<RevivableContext, ConnectionMessagePortState>()

const getState = (context: RevivableContext): ConnectionMessagePortState => {
  const state = connectionStateMap.get(context)
  if (!state) throw new Error('osra message-port: connection state missing; did init() run?')
  return state
}

export const init = (context: RevivableContext): void => {
  const state: ConnectionMessagePortState = { portHandlers: new Map() }
  connectionStateMap.set(context, state)

  context.eventTarget.addEventListener('message', ({ detail }) => {
    if (detail.type !== 'message' && detail.type !== 'message-port-close') return
    state.portHandlers.get(detail.portId)?.(detail)
  })
}

export const isType = (value: unknown): value is MessagePort | EventPort<StructurableTransferable> =>
  value instanceof MessagePort || value instanceof EventPort

const sendClose = (context: RevivableContext, portId: Uuid) => {
  try {
    context.sendMessage({ type: 'message-port-close', remoteUuid: context.remoteUuid, portId })
  } catch { /* connection torn down */ }
}

const postRevived = <T>(port: AnyPort<T>, data: T, synthetic: boolean) => {
  if (synthetic) port.postMessage(data)
  else port.postMessage(data, getTransferableObjects(data))
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

  const { portHandlers } = getState(context)
  const liveRef: AnyPort<T> = value
  const portId: Uuid = globalThis.crypto.randomUUID()

  let cleanedUp = false
  const performCleanup = () => {
    if (cleanedUp) return
    cleanedUp = true
    portHandlers.delete(portId)
    unregisterGc?.()
    liveRef.removeEventListener('message', outgoingListener as EventListener)
  }

  const handler = (message: Messages) => {
    if (message.type === 'message-port-close') {
      performCleanup()
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
    })
  }

  // Safety net only — `handler` strong-holds liveRef via portHandlers, so
  // the FR won't fire while the connection is alive. Real cleanup runs via
  // the wire `message-port-close` or EventPort `_onClose`.
  const unregisterGc = trackGc(liveRef, () => {
    sendClose(context, portId)
    performCleanup()
  })

  liveRef.addEventListener('message', outgoingListener as EventListener)
  liveRef.start()

  if (liveRef instanceof EventPort) {
    liveRef._onClose = () => {
      if (cleanedUp) return
      sendClose(context, portId)
      performCleanup()
    }
  }

  portHandlers.set(portId, handler)

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
 *  EventTarget that auto-boxes/revives — letting live values (Promises,
 *  Functions, …) ride a clone-only transport. */
const createProtocolPort = <T>(
  port: TypedMessagePort<Capable>,
  ctx: RevivableContext,
): TypedMessagePort<T> => {
  const target = new EventTarget() as TypedMessagePort<T>
  const onMessage = ({ data }: MessageEvent<Capable>): void => {
    target.dispatchEvent(new MessageEvent('message', { data: recursiveRevive(data, ctx) }))
  }
  port.addEventListener('message', onMessage)
  target.postMessage = (data: T, opt?: Transferable[] | StructuredSerializeOptions) => {
    const boxed = recursiveBox(data as Capable, ctx)
    const transferables = getTransferableObjects(boxed)
    const extra = Array.isArray(opt) ? opt : []
    port.postMessage(boxed, extra.length ? [...transferables, ...extra] : transferables)
  }
  target.start = () => port.start()
  target.close = () => {
    port.removeEventListener('message', onMessage)
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
  const { port1, port2 } = new MessageChannel() as unknown as {
    port1: TypedMessagePort<Capable>
    port2: TypedMessagePort<Capable>
  }
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
  const { portHandlers } = getState(context)
  const { port1: userPort, port2: internalPort } =
    synthetic
      ? new EventChannel<T, T>()
      : new MessageChannel() as { port1: TypedMessagePort<T>, port2: TypedMessagePort<T> }
  const userPortRef = new WeakRef(userPort)
  // For synthetic EventChannels, internalPort._peer === userPort — holding
  // internalPort strongly from the trackGc cleanup would re-pin userPort.
  const internalPortRef = new WeakRef(internalPort)

  let cleanedUp = false
  const performCleanup = () => {
    if (cleanedUp) return
    cleanedUp = true
    portHandlers.delete(portId)
    const internal = internalPortRef.deref()
    internal?.removeEventListener('message', internalPortListener as EventListener)
    internal?.close()
    unregisterGc?.()
  }

  const handler = (message: Messages) => {
    if (message.type === 'message-port-close') {
      performCleanup()
      userPortRef.deref()?.close()
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
  box({} as TypedMessagePort<Promise<string>>, {} as RevivableContext)
}

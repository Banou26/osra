import type { Capable, StructurableTransferable } from '../types'
import type { TypedMessagePort } from '../utils/typed-message-channel'
import type { RevivableContext, BoxBase as BoxBaseType } from './utils'
import type { UnderlyingType } from '../utils/type'
import type { HandleId } from '../utils/remote-handle'
import type {
  BadFieldValue, BadFieldPath, BadFieldParent,
  ErrorMessage, BadValue, Path, ParentObject
} from '../utils/capable-check'

import { BoxBase } from './utils'
import { recursiveBox, recursiveRevive } from '.'
import { getTransferableObjects, isJsonOnlyTransport } from '../utils'
import { EventChannel, EventPort } from '../utils/event-channel'
import { createHandle, adoptHandle } from '../utils/remote-handle'

export const type = 'messagePort' as const

/** Any port-shape the message-port revivable accepts. Real MessagePorts and
 *  synthetic EventPorts both flow through here. */
export type AnyPort<T = Capable> =
  | TypedMessagePort<T>
  | EventPort<T>

export type BoxedMessagePort<T = Capable> =
  & BoxBaseType<typeof type>
  & (
    /** Origin was a synthetic EventPort — must revive as an EventPort so
     *  live (non-clonable) Promises/Functions/etc. flow by reference. */
    | { handleId: HandleId, synthetic: true }
    /** Origin was a real MessagePort but the transport can't carry ports
     *  (JSON-only) — revive produces a real MessagePort proxy via a local
     *  MessageChannel, with payloads flowing through the handle. */
    | { handleId: HandleId, synthetic: false }
    /** Origin was a real MessagePort and the transport supports
     *  structured-clone transfer — port rides the wire directly with
     *  default structured-clone semantics. No handle needed; port lifetime
     *  is the user's responsibility (their own `close()`). */
    | { port: AnyPort<T> }
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

export const isType = (value: unknown): value is MessagePort | EventPort<StructurableTransferable> =>
  value instanceof MessagePort || value instanceof EventPort

export const box = <T, T2 extends RevivableContext = RevivableContext>(
  value: StructurableTransferablePort<T>,
  context: T2,
): BoxedMessagePort<T> => {
  // Synthetic EventPorts aren't structured-clonable, so even on a clone
  // transport they have to ride a handle — sending them inline would
  // crash with DataCloneError.
  const synthetic = value instanceof EventPort
  if (synthetic || isJsonOnlyTransport(context.transport)) {
    const liveRef: AnyPort<T> = value

    const handle = createHandle(context, {
      // Peer wrote into its end of the user's channel — revive the
      // payload back into a live value and deliver it on our side.
      onMessage: (payload) => {
        const revived = recursiveRevive(payload, context) as T
        // Real MessagePorts need transferables on the transfer list;
        // EventPorts pass by reference and ignore the option.
        if (synthetic) liveRef.postMessage(revived)
        else liveRef.postMessage(revived, getTransferableObjects(revived))
      },
      onRelease: () => {
        // Either the peer's userPort was collected or it explicitly
        // released — close the local end so user code on this side sees
        // a dead channel rather than silently swallowing future posts.
        try { liveRef.close() } catch { /* may already be closed */ }
      },
    })

    // Outgoing: user wrote into their end → box and forward to peer.
    // Swallow per-message failures — a real MessagePort drops messages
    // when the channel is closed too, so divergence here would be more
    // surprising than the silent drop.
    const onOutgoing = ({ data }: MessageEvent<Capable>) => {
      try { handle.send(recursiveBox(data, context)) }
      catch { /* not serialisable / connection torn down */ }
    }
    liveRef.addEventListener('message', onOutgoing as EventListener)
    liveRef.start()

    // EventPorts surface explicit close via _onClose — wire it so user
    // code calling liveRef.close() tears down the handle and notifies
    // the peer. Real MessagePorts have no equivalent hook; their
    // teardown relies on the peer-side FR firing when its userPort
    // dies.
    if (liveRef instanceof EventPort) {
      liveRef._onClose = () => handle.release()
    }

    return { ...BoxBase, type, handleId: handle.id, synthetic } as BoxedMessagePort<T>
  }
  // Real MessagePort + clone transport: ride the wire by structured-clone.
  return {
    ...BoxBase,
    type,
    port: value,
  } as BoxedMessagePort<T>
}

export const revive = <T extends Capable, T2 extends RevivableContext>(
  value: BoxedMessagePort<T>,
  context: T2,
): TypedMessagePort<T> => {
  if ('port' in value) return value.port as TypedMessagePort<T>
  // handleId path: origin was either a synthetic EventPort (pass-by-ref
  // for live values) or a real MessagePort the transport couldn't clone
  // (JSON-only). EventPorts revive as EventPorts so live values flow
  // through unchanged; MessagePorts revive as MessagePorts so the
  // receiver sees the same shape they'd get from a real `transfer`.
  return reviveViaHandle<T>(value.handleId, context, value.synthetic)
}

const reviveViaHandle = <T extends Capable>(
  handleId: HandleId,
  context: RevivableContext,
  synthetic: boolean,
): TypedMessagePort<T> => {
  const { port1: userPort, port2: internalPort } =
    synthetic
      ? new EventChannel<T, T>()
      : new MessageChannel() as { port1: TypedMessagePort<T>, port2: TypedMessagePort<T> }

  // Adopt the peer's handle. Tracked value is `userPort` — when the user
  // drops it, the FR releases the handle and notifies the peer to tear
  // down its own end.
  const handle = adoptHandle(context, handleId, {
    onMessage: (payload) => {
      const revived = recursiveRevive(payload, context) as T
      if (synthetic) internalPort.postMessage(revived)
      else internalPort.postMessage(revived, getTransferableObjects(revived))
    },
    onRelease: () => {
      // Peer's end is gone — tear down our internal half and close the
      // user-facing port so any further postMessage on our side noops.
      internalPort.removeEventListener('message', onOutgoing as EventListener)
      try { internalPort.close() } catch { /* may already be closed */ }
      try { userPort.close() } catch { /* may already be closed */ }
    },
  }, userPort)

  const onOutgoing = ({ data }: MessageEvent<T>) => {
    try { handle.send(recursiveBox(data, context)) }
    catch { /* not serialisable / connection torn down */ }
  }
  internalPort.addEventListener('message', onOutgoing as EventListener)
  internalPort.start()

  // Synthetic ports surface user-side close via _onClose; do the same
  // teardown locally and notify the peer.
  if (userPort instanceof EventPort) {
    userPort._onClose = () => handle.release()
  }

  return userPort
}

const typeCheck = () => {
  const port = {} as TypedMessagePort<{ foo: string }>
  const boxed = box(port, {} as RevivableContext)
  const revived = revive(boxed, {} as RevivableContext)
  const expected: AnyPort<{ foo: string }> = revived
  // @ts-expect-error - wrong message type
  const wrongType: AnyPort<{ bar: number }> = revived
  // Promise-valued messages are fine — handle pass-by-reference means we
  // don't need StructurableTransferable here.
  box({} as TypedMessagePort<Promise<string>>, {} as RevivableContext)
}

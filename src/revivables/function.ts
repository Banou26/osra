import type { Capable } from '../types'
import type { UnderlyingType, RevivableContext, BoxBase as BoxBaseType } from './utils'

import { BoxBase, serializeError } from './utils'
import { recursiveBox } from '.'
import { getTransferableObjects } from '../utils'
import { EventChannel, type EventPort } from '../utils/event-channel'
import { trackGc } from '../utils/gc-tracker'
import { box as boxMessagePort, revive as reviveMessagePort, BoxedMessagePort } from './message-port'

export const type = 'function' as const

type ResultMessage =
  | { __osra_ok__: true, value: Capable }
  | { __osra_err__: true, error: string }

/** Wire payload of a single call: [boxed return-port, recursively-boxed args].
 *  After revival on the box side, the port is a live `EventPort` we can
 *  post the boxed wrapper on. */
type CallContext = [EventPort<Capable>, Capable[]]

/** Sentinel sent from the revive side when the proxy is collected, telling
 *  the box side to drop its half of the function channel. */
type CloseSignal = { __osra_close__: true }

// Pins return-value ports between executor return and result arrival. The
// (port ↔ once-listener ↔ resolve/reject) cycle has no external anchor
// after `func` returns the Promise — V8 may collect the cycle before the
// result comes back, leaving the await hung forever. The once-listener
// removes its entry on settle.
const inFlightReturnPorts = new Set<EventPort<Capable>>()

export type BoxedFunction<T extends (...args: any[]) => any = (...args: any[]) => any> =
  & BoxBaseType<typeof type>
  & { port: BoxedMessagePort<CallContext | CloseSignal> }
  & { [UnderlyingType]: (...args: Parameters<T>) => Promise<Awaited<ReturnType<T>>> }

type CapableFunction<T> = T extends (...args: infer P) => infer R
  ? P extends Capable[]
    ? R extends Capable ? T : never
    : never
  : never

export const isType = (value: unknown): value is (...args: any[]) => any =>
  typeof value === 'function'

export const box = <T extends (...args: any[]) => any, T2 extends RevivableContext>(
  value: T & CapableFunction<T>,
  context: T2,
): BoxedFunction<T> => {
  // EventChannel rather than MessageChannel: revived live values
  // (function-revives, EventTarget façades, …) are non-clonable, and the
  // message-port handler's `liveRef.postMessage(revivedData)` would throw
  // DataCloneError for any of those if `liveRef` were a real MessagePort.
  // EventPorts pass by reference so live values survive in-realm.
  const { port1: localPort, port2: remotePort } = new EventChannel<CallContext | CloseSignal, CallContext | CloseSignal>()

  localPort.addEventListener('message', ({ data }) => {
    if (data && typeof data === 'object' && '__osra_close__' in data) {
      // Revive side dropped the proxy — tear down our half of the channel.
      localPort.close()
      return
    }
    // Don't recursiveRevive here — the message-port handler that
    // forwarded `data` to us has already revived everything in place.
    // Re-walking would `Object.fromEntries` plain object args, creating
    // fresh references that break identity round-trip semantics.
    const [returnPort, args] = data as CallContext
    // Await the result on the box side and ship back a {__osra_ok__/err}
    // wrapper. The wrapper is plain data, so even a live revived value
    // nested inside (BoxedFunction etc.) flows through the channel as
    // its boxed shape.
    ;(async () => {
      let message: ResultMessage
      try {
        const resolved = await value(...(args as Parameters<T>))
        message = { __osra_ok__: true, value: resolved as Capable }
      } catch (error) {
        message = { __osra_err__: true, error: serializeError(error) }
      }
      try {
        const boxedResult = recursiveBox(message as Capable, context)
        returnPort.postMessage(boxedResult, getTransferableObjects(boxedResult))
      } catch (postErr) {
        // Result wasn't boxable / clonable — surface as a remote error so
        // the caller's await rejects rather than hanging on a message
        // that can never reach them.
        try {
          returnPort.postMessage({ __osra_err__: true, error: serializeError(postErr) } satisfies ResultMessage)
        } catch { /* error itself failed to serialise */ }
      }
      // Close after the post's microtask flushes so the result actually
      // reaches the peer before the channel tears down. The close fires
      // returnPort's _onClose, which sends `message-port-close` and lets
      // both sides drop the per-call routing entries — without it the
      // portHandlers map grows one entry per call.
      queueMicrotask(() => {
        try { returnPort.close() } catch { /* may already be closed */ }
      })
    })()
  })
  localPort.start()

  return {
    ...BoxBase,
    type,
    port: boxMessagePort(remotePort as unknown as MessagePort, context),
  } as unknown as BoxedFunction<T>
}

export const revive = <T extends BoxedFunction, T2 extends RevivableContext>(
  value: T,
  context: T2,
): T[UnderlyingType] => {
  const port = reviveMessagePort(value.port, context) as unknown as MessagePort

  const func = (...args: Capable[]) =>
    new Promise((resolve, reject) => {
      // EventChannel for the same reason as in `box`: revived live values
      // arriving in the wrapper must reach the once-listener intact.
      const { port1: returnLocal, port2: returnRemote } = new EventChannel<Capable, Capable>()
      inFlightReturnPorts.add(returnLocal)

      returnLocal.addEventListener('message', ({ data }) => {
        // `data` was already revived by the message-port handler; re-walking
        // would `Object.fromEntries` any plain-object payloads, breaking
        // identity round-trip references.
        const message = data as ResultMessage
        if ('__osra_ok__' in message) resolve(message.value)
        else reject(message.error)
        returnLocal.close()
        inFlightReturnPorts.delete(returnLocal)
      }, { once: true })
      returnLocal.start()

      try {
        const callContext = recursiveBox([returnRemote, args] as unknown as Capable, context)
        port.postMessage(callContext, getTransferableObjects(callContext))
      } catch (sendErr) {
        // Boxing/transferring threw synchronously (DataCloneError on a
        // clone transport, etc). The pin and the never-firing listener
        // would leak forever otherwise.
        inFlightReturnPorts.delete(returnLocal)
        try { returnLocal.close() } catch { /* may already be closed */ }
        reject(sendErr)
      }
    })

  // Tell the box side to close its half of the channel when our proxy is
  // collected. No in-flight rejection — abandoned awaits stay pending until
  // the result arrives or the user wraps them in a timeout.
  trackGc(func, () => {
    try { port.postMessage({ __osra_close__: true }) } catch { /* port may already be closed */ }
    try { port.close() } catch { /* port may already be closed */ }
  })

  return func as T[UnderlyingType]
}

const typeCheck = () => {
  const boxed = box((a: number, b: string) => a + b.length, {} as RevivableContext)
  const revived = revive(boxed, {} as RevivableContext)
  const expected: (a: number, b: string) => Promise<number> = revived
  // @ts-expect-error - wrong return type
  const wrongReturn: (a: number, b: string) => Promise<string> = revived
  // @ts-expect-error - wrong parameter types
  const wrongParams: (a: string, b: number) => Promise<number> = revived
  // @ts-expect-error - non-Capable parameter type (symbols aren't structured-clonable)
  box((a: symbol) => a.toString(), {} as RevivableContext)
  // @ts-expect-error - non-Capable return type
  box(() => Symbol(), {} as RevivableContext)
}

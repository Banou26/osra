import type { Capable } from '../types'
import type { UnderlyingType, RevivableContext, BoxBase as BoxBaseType } from './utils'

import { BoxBase, serializeError } from './utils'
import { recursiveBox } from '.'
import { getTransferableObjects } from '../utils'
import { EventChannel, type EventPort } from '../utils/event-channel'
import { box as boxMessagePort, revive as reviveMessagePort, BoxedMessagePort } from './message-port'

export const type = 'function' as const

type ResultMessage =
  | { __osra_ok__: true, value: Capable }
  | { __osra_err__: true, error: string }

type CallContext = [EventPort<Capable>, Capable[]]

// Pins return-value ports between call-site return and result arrival —
// the (port ↔ once-listener ↔ resolve/reject) cycle has no other anchor.
const inFlightReturnPorts = new Set<EventPort<Capable>>()

export type BoxedFunction<T extends (...args: any[]) => any = (...args: any[]) => any> =
  & BoxBaseType<typeof type>
  & { port: BoxedMessagePort<CallContext> }
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
  // EventChannel rather than MessageChannel: revived live values arriving
  // in args (functions, EventTarget façades, …) aren't structured-clonable.
  const { port1: localPort, port2: remotePort } = new EventChannel<CallContext, CallContext>()

  localPort.addEventListener('message', ({ data }) => {
    // Don't recursiveRevive — message-port handler already revived in place.
    // Re-walking would Object.fromEntries plain args, breaking identity.
    const [returnPort, args] = data as CallContext
    ;(async () => {
      let message: ResultMessage
      try {
        const resolved = await value(...(args as Parameters<T>))
        message = { __osra_ok__: true, value: resolved as Capable }
      } catch (error) {
        message = { __osra_err__: true, error: serializeError(error) }
      }
      const boxedResult = recursiveBox(message as Capable, context)
      returnPort.postMessage(boxedResult, getTransferableObjects(boxedResult))
      // Defer close so the result reaches the peer before tear-down. The
      // close fires _onClose, dropping per-call routing entries on both
      // sides — without it portHandlers grows one entry per call.
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

  return ((...args: Capable[]) =>
    new Promise((resolve, reject) => {
      const { port1: returnLocal, port2: returnRemote } = new EventChannel<Capable, Capable>()
      inFlightReturnPorts.add(returnLocal)

      returnLocal.addEventListener('message', ({ data }) => {
        const message = data as ResultMessage
        if ('__osra_ok__' in message) resolve(message.value)
        else reject(message.error)
        returnLocal.close()
        inFlightReturnPorts.delete(returnLocal)
      }, { once: true })
      returnLocal.start()

      const callContext = recursiveBox([returnRemote, args] as unknown as Capable, context)
      port.postMessage(callContext, getTransferableObjects(callContext))
    })) as T[UnderlyingType]
}

const typeCheck = () => {
  const boxed = box((a: number, b: string) => a + b.length, {} as RevivableContext)
  const revived = revive(boxed, {} as RevivableContext)
  const expected: (a: number, b: string) => Promise<number> = revived
  // @ts-expect-error - wrong return type
  const wrongReturn: (a: number, b: string) => Promise<string> = revived
  // @ts-expect-error - wrong parameter types
  const wrongParams: (a: string, b: number) => Promise<number> = revived
  // @ts-expect-error - non-Capable parameter type (WeakMap isn't structured-clonable)
  box((a: WeakMap<object, string>) => a.toString(), {} as RevivableContext)
  // @ts-expect-error - non-Capable return type
  box(() => new WeakMap<object, string>(), {} as RevivableContext)
}

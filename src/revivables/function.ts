import type { Capable } from '../types'
import type { UnderlyingType, RevivableContext, BoxBase as BoxBaseType } from './utils'
import type { TypedMessagePort } from '../utils/typed-message-channel'
import type { AnyPort } from './message-port'

import { BoxBase } from './utils'
import { EventChannel } from '../utils/event-channel'
import { getTransferableObjects, isJsonOnlyTransport } from '../utils'
import { recursiveBox, recursiveRevive } from '.'
import {
  box as boxMessagePort,
  revive as reviveMessagePort,
  BoxedMessagePort,
} from './message-port'

export const type = 'function' as const

type ResultMessage =
  | { __osra_ok__: true, value: Capable }
  | { __osra_err__: true, error: string }

type CallMessage = CallContext | { __osra_close__: true }

/**
 * FinalizationRegistry for automatically cleaning up function ports when the revived function is garbage collected.
 */
type FunctionCleanupInfo = {
  port: TypedMessagePort<CallMessage>
}

const functionRegistry = new FinalizationRegistry<FunctionCleanupInfo>((info) => {
  try {
    info.port.postMessage({ __osra_close__: true })
  } catch { /* Port may already be closed */ }
  try {
    info.port.close()
  } catch { /* Port may already be closed */ }
})

// Pins caller-side return-value ports between send and result arriving. The
// cycle (localPort↔listener↔remotePort) has no external anchor after the
// Promise executor returns, so under memory pressure GC can collect it before
// the result arrives — the Promise hangs forever. We remove the entries in
// the once-listener (and on reject).
const inFlightReturnPorts = new Set<AnyPort<any>>()

export type CallContext = [
  /** Return-value port that the callee will post the result on. May be a
   *  synthetic EventPort (JSON transport) or a real MessagePort (clone). */
  AnyPort<ResultMessage>,
  /** Arguments that will be passed to the function call */
  Capable[]
]

export type BoxedFunction<T extends (...args: any[]) => any = (...args: any[]) => any> =
  & BoxBaseType<typeof type>
  & { port: BoxedMessagePort<CallMessage> }
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
  context: T2
): BoxedFunction<T> => {
  // Clone-capable transports get a real MessageChannel so the remote port is
  // transferred directly (message-port fast path). JSON-only transports fall
  // back to EventChannel, which routes through the portId handler and boxes
  // on the wire for us.
  const isJson = isJsonOnlyTransport(context.transport)
  const { port1: localPort, port2: remotePort } = isJson
    ? new EventChannel<CallMessage, CallMessage>()
    : new MessageChannel() as unknown as { port1: TypedMessagePort<CallMessage>, port2: TypedMessagePort<CallMessage> }

  const cleanup = () => {
    localPort.close()
    // remotePort may have been transferred (clone path) or boxed via
    // message-port's portId path (JSON path). Closing it from this side is
    // a no-op once transferred, and fires the _onClose hook otherwise.
    remotePort.close()
  }

  localPort.addEventListener('message', ({ data: rawData }) => {
    // On clone transports the incoming data is structured-cloned as-is —
    // any Capable args were boxed by the revive side and need reviving.
    // Ports (returnPort) arrive pre-transferred, so they pass through the
    // recursive walker untouched.
    const data = isJson ? rawData : recursiveRevive(rawData, context) as CallMessage
    if (!Array.isArray(data)) {
      // __osra_close__ sentinel — only non-array message on this channel
      cleanup()
      return
    }
    const [returnPort, args] = data
    ;(async () => value(...(args as Parameters<T>)))()
      .then(
        (resolved): ResultMessage => ({ __osra_ok__: true, value: resolved }),
        (error: unknown): ResultMessage => ({
          __osra_err__: true,
          error: error instanceof Error ? (error.stack ?? String(error)) : String(error),
        }),
      )
      .then((result) => {
        if (isJson) {
          returnPort.postMessage(result)
        } else {
          const boxed = recursiveBox(result, context) as ResultMessage
          ;(returnPort as TypedMessagePort<ResultMessage>).postMessage(boxed, getTransferableObjects(boxed))
        }
      })
      .finally(() => {
        // Close after the message has flushed through the microtask queue so
        // the result actually dispatches before we tear the channel down.
        queueMicrotask(() => returnPort.close())
      })
  })
  localPort.start()

  return {
    ...BoxBase,
    type,
    port: boxMessagePort(remotePort, context)
  } as BoxedFunction<T>
}

export const revive = <T extends BoxedFunction, T2 extends RevivableContext>(
  value: T,
  context: T2
): T[UnderlyingType] => {
  const port = reviveMessagePort(value.port, context)
  const isJson = isJsonOnlyTransport(context.transport)

  const func = (...args: Capable[]) =>
    new Promise((resolve, reject) => {
      const { port1: returnValueLocalPort, port2: returnValueRemotePort } = isJson
        ? new EventChannel<ResultMessage, ResultMessage>()
        : new MessageChannel() as unknown as { port1: TypedMessagePort<ResultMessage>, port2: TypedMessagePort<ResultMessage> }
      // Pin ports to a module-level Set so GC can't collect the
      // port↔listener cycle while the call is in flight. Without this,
      // under memory pressure the listener (and thus `resolve`) can be
      // collected before the result arrives — the Promise hangs forever.
      inFlightReturnPorts.add(returnValueLocalPort)
      inFlightReturnPorts.add(returnValueRemotePort)

      const callMsg: CallContext = [returnValueRemotePort, args]
      if (isJson) {
        port.postMessage(callMsg)
      } else {
        const boxedArgs = recursiveBox(args, context) as Capable[]
        const boxedCall: CallContext = [returnValueRemotePort, boxedArgs]
        ;(port as TypedMessagePort<CallMessage>).postMessage(
          boxedCall as CallMessage,
          // Must transfer the return-value remote port so it lands as a live
          // MessagePort on the box side, ready to receive the result.
          [returnValueRemotePort as MessagePort, ...getTransferableObjects(boxedArgs)],
        )
      }

      returnValueLocalPort.addEventListener('message', ({ data: rawData }) => {
        const result = isJson ? rawData : recursiveRevive(rawData, context) as ResultMessage
        if ('__osra_ok__' in result) resolve(result.value)
        else reject(result.error)
        returnValueLocalPort.close()
        // Close remote side too — its _onClose (set by message-port.box)
        // tears down handler state on this connection so per-call state
        // doesn't accumulate across iterations.
        returnValueRemotePort.close()
        inFlightReturnPorts.delete(returnValueLocalPort)
        inFlightReturnPorts.delete(returnValueRemotePort)
      }, { once: true })
      returnValueLocalPort.start()
    })

  // Register the function for automatic cleanup when garbage collected
  functionRegistry.register(func, { port }, func)

  return func
}

const typeCheck = () => {
  const boxed = box((a: number, b: string) => a + b.length, {} as RevivableContext)
  const revived = revive(boxed, {} as RevivableContext)
  const expected: (a: number, b: string) => Promise<number> = revived
  // @ts-expect-error - wrong return type
  const wrongReturn: (a: number, b: string) => Promise<string> = revived
  // @ts-expect-error - wrong parameter types
  const wrongParams: (a: string, b: number) => Promise<number> = revived
  // @ts-expect-error - non-Capable parameter type (Set is not directly Capable as parameter)
  box((a: WeakMap<object, string>) => a, {} as RevivableContext)
  // @ts-expect-error - non-Capable return type
  box(() => new WeakMap(), {} as RevivableContext)
}

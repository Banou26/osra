import type { Capable } from '../types'
import type { UnderlyingType, RevivableContext, BoxBase as BoxBaseType } from './utils'
import type { TypedMessagePort } from '../utils/typed-message-channel'
import type { AnyPort } from './message-port'

import { BoxBase, serializeError } from './utils'
import {
  createRevivableChannel,
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

/** Call-site payload (sent over the wire): the return port is pre-boxed by
 *  createRevivableChannel; args are passed live and boxed by the channel. */
type SentCallContext = [BoxedMessagePort<ResultMessage>, Capable[]]

/** Call-site payload as received by the callee, after box-side revival: the
 *  return port is now a live AnyPort<ResultMessage> (ProtocolPort on clone,
 *  EventPort on JSON); args are revived. */
export type CallContext = [AnyPort<ResultMessage>, Capable[]]

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
  const { localPort, boxedRemote } = createRevivableChannel<CallMessage>(context)

  const cleanup = () => {
    localPort.close()
  }

  localPort.addEventListener('message', ({ data }) => {
    if (!Array.isArray(data)) {
      // __osra_close__ sentinel — only non-array message on this channel
      cleanup()
      return
    }
    const [returnPort, args] = data
    ;(async () => value(...(args as Parameters<T>)))()
      .then(
        (resolved) => returnPort.postMessage({ __osra_ok__: true, value: resolved }),
        (error: unknown) => returnPort.postMessage({
          __osra_err__: true,
          error: serializeError(error),
        }),
      )
      .finally(() => {
        // Close after the message has flushed through the microtask queue so
        // the result actually dispatches before we tear the channel down.
        queueMicrotask(() => returnPort.close())
      })
  })
  localPort.start()

  return { ...BoxBase, type, port: boxedRemote } as BoxedFunction<T>
}

export const revive = <T extends BoxedFunction, T2 extends RevivableContext>(
  value: T,
  context: T2
): T[UnderlyingType] => {
  const port = reviveMessagePort(value.port, context)

  const func = (...args: Capable[]) =>
    new Promise((resolve, reject) => {
      const { localPort: returnLocal, boxedRemote: returnBoxedRemote } =
        createRevivableChannel<ResultMessage>(context)
      // Pin ports to a module-level Set so GC can't collect the
      // port↔listener cycle while the call is in flight. Without this,
      // under memory pressure the listener (and thus `resolve`) can be
      // collected before the result arrives — the Promise hangs forever.
      inFlightReturnPorts.add(returnLocal)

      port.postMessage([returnBoxedRemote, args] as SentCallContext as unknown as CallMessage)

      returnLocal.addEventListener('message', ({ data: result }) => {
        if ('__osra_ok__' in result) resolve(result.value)
        else reject(result.error)
        returnLocal.close()
        inFlightReturnPorts.delete(returnLocal)
      }, { once: true })
      returnLocal.start()
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

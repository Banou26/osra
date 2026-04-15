import type { Capable } from '../types'
import type { UnderlyingType, RevivableContext, BoxBase as BoxBaseType } from './utils'

import { BoxBase } from './utils'
import { EventChannel, EventPort } from '../utils/event-channel'
import {
  box as boxMessagePort,
  revive as reviveMessagePort,
  BoxedMessagePort
} from './message-port'

export const type = 'function' as const

type CallMessage = CallContext | { __osra_close__: true }

/**
 * FinalizationRegistry for automatically cleaning up function ports when the revived function is garbage collected.
 */
type FunctionCleanupInfo = {
  port: EventPort<CallMessage>
}

const functionRegistry = new FinalizationRegistry<FunctionCleanupInfo>((info) => {
  try {
    info.port.postMessage({ __osra_close__: true })
  } catch { /* Port may already be closed */ }
  try {
    info.port.close()
  } catch { /* Port may already be closed */ }
})

export type CallContext = [
  /** Return-value port that the callee will post the result on. */
  EventPort<Capable>,
  /** Arguments that will be passed to the function call */
  Capable[]
]

export type BoxedFunction<T extends (...args: any[]) => any = (...args: any[]) => any> =
  & BoxBaseType<typeof type>
  & { port: BoxedMessagePort }
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
  // EventChannel (pass-by-reference) — live values flow through unchanged;
  // the message-port revivable boxes them if/when they cross the transport.
  const { port1: localPort, port2: remotePort } = new EventChannel<CallMessage, CallMessage>()

  const cleanup = () => {
    localPort.close()
  }

  localPort.addEventListener('message', ({ data }) => {
    if (data && typeof data === 'object' && '__osra_close__' in data) {
      cleanup()
      return
    }
    const [returnValuePort, args] = data as CallContext
    const result = (async () => value(...(args as Parameters<T>)))()
    returnValuePort.postMessage(result)
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
  const port = reviveMessagePort(value.port as unknown as BoxedMessagePort<CallMessage>, context)

  const func = (...args: Capable[]) =>
    new Promise((resolve, reject) => {
      const { port1: returnValueLocalPort, port2: returnValueRemotePort } = new EventChannel<Capable, Capable>()
      port.postMessage([returnValueRemotePort, args])

      returnValueLocalPort.addEventListener('message', ({ data: result }) => {
        // data is already revived (message-port handed us live values)
        ;(result as Promise<Capable>)
          .then(resolve)
          .catch(reject)
          .finally(() => {
            returnValueLocalPort.close()
          })
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

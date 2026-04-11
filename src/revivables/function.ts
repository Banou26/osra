import type { Capable } from '../types'
import type { StrictMessagePort } from '../utils/message-channel'
import type { UnderlyingType, RevivableContext, BoxBase as BoxBaseType } from './utils'

import { BoxBase } from './utils'
import { CapableChannel } from '../utils/message-channel'
import { box as boxMessagePort, revive as reviveMessagePort, BoxedMessagePort } from './message-port'

export const type = 'function' as const

/**
 * FinalizationRegistry for automatically cleaning up function ports when the
 * revived function is garbage collected.
 */
type FunctionCleanupInfo = {
  port: StrictMessagePort<CallContextOrClose>
}

const functionRegistry = new FinalizationRegistry<FunctionCleanupInfo>((info) => {
  try {
    info.port.postMessage({ __osra_close__: true } as unknown as CallContextOrClose)
  } catch { /* Port may already be closed */ }
  try {
    info.port.close()
  } catch { /* Port may already be closed */ }
})

export type CallContext = [
  /** MessagePort the result of the call will be posted back on */
  StrictMessagePort<Promise<Capable>>,
  /** Arguments forwarded to the function */
  Capable[],
]

type CallContextOrClose = CallContext | { __osra_close__: true }

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
  context: T2,
): BoxedFunction<T> => {
  // CapableChannel — the call context arrives already revived at the
  // message-port boundary, so we can read it directly without needing to
  // run recursiveRevive ourselves.
  const { port1: localPort, port2: remotePort } =
    new CapableChannel<CallContextOrClose, CallContextOrClose>()

  localPort.addEventListener('message', (event) => {
    const data = (event as MessageEvent<CallContextOrClose>).data
    if (data && typeof data === 'object' && '__osra_close__' in data) {
      localPort.close()
      return
    }
    const [returnValuePort, args] = data
    const result = (async () => value(...args))()
    // Post the raw Promise through the stub channel. The message-port
    // tunnel boundary on the receiving side will box/revive it.
    returnValuePort.postMessage(result as unknown as Promise<Capable>)
  })
  localPort.start()

  return {
    ...BoxBase,
    type,
    port: boxMessagePort(remotePort, context),
  } as BoxedFunction<T>
}

export const revive = <T extends BoxedFunction, T2 extends RevivableContext>(
  value: T,
  context: T2,
): T[UnderlyingType] => {
  const port = reviveMessagePort(
    value.port as unknown as BoxedMessagePort<CallContextOrClose>,
    context,
  )

  const func = (...args: Capable[]) =>
    new Promise((resolve, reject) => {
      const { port1: returnValueLocalPort, port2: returnValueRemotePort } =
        new CapableChannel<Promise<Capable>, Promise<Capable>>()

      // Post raw values — returnValueRemotePort is a stub that passes by
      // reference. The message-port tunnel boundary boxes it on the wire
      // for us and the receiving side unboxes back into a real port.
      port.postMessage([returnValueRemotePort, args] as unknown as CallContextOrClose)

      returnValueLocalPort.addEventListener('message', (event) => {
        const result = (event as MessageEvent<Promise<Capable>>).data
        result
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
  // @ts-expect-error - non-Capable parameter type (Set is not directly Capable as parameter)
  box((a: WeakMap<object, string>) => a, {} as RevivableContext)
  // @ts-expect-error - non-Capable return type
  box(() => new WeakMap(), {} as RevivableContext)
}

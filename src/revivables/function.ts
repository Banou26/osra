import type { Capable } from '../types'
import type { UnderlyingType, RevivableContext, BoxBase as BoxBaseType } from './utils'

import { BoxBase } from './utils'
import { recursiveBox, recursiveRevive } from '.'
import { getTransferableObjects } from '../utils'
import { box as boxMessagePort, revive as reviveMessagePort, BoxedMessagePort } from './message-port'

export const type = 'function' as const

/**
 * FinalizationRegistry for automatically cleaning up function ports when the revived function is garbage collected.
 */
type FunctionCleanupInfo = {
  port: MessagePort
}

const functionRegistry = new FinalizationRegistry<FunctionCleanupInfo>((info) => {
  // Send a close signal through the port before closing it
  try {
    info.port.postMessage({ __osra_close__: true })
  } catch { /* Port may already be closed */ }
  try {
    info.port.close()
  } catch { /* Port may already be closed */ }
})

export type CallContext = [
  /** MessagePort or portId that will be used to send the result of the function call */
  MessagePort | string,
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
  const { port1: localPort, port2: remotePort } = new MessageChannel()
  context.messagePorts.add(remotePort)

  const cleanup = () => {
    context.messagePorts.delete(remotePort)
    localPort.close()
  }

  localPort.addEventListener('message', ({ data }: MessageEvent<CallContext | { __osra_close__: true }>) => {
    // Check for close signal
    if (data && typeof data === 'object' && '__osra_close__' in data) {
      cleanup()
      return
    }
    const [returnValuePort, args] = recursiveRevive(data as CallContext, context) as [MessagePort, Capable[]]
    const result = (async () => value(...args))()
    const boxedResult = recursiveBox(result, context)
    returnValuePort.postMessage(boxedResult, getTransferableObjects(boxedResult))
  })
  localPort.start()

  return {
    ...BoxBase,
    type,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    port: boxMessagePort(remotePort as any, context)
  } as BoxedFunction<T>
}

export const revive = <T extends BoxedFunction, T2 extends RevivableContext>(
  value: T,
  context: T2
): T[UnderlyingType] => {
  const port = reviveMessagePort(value.port as unknown as BoxedMessagePort, context)

  const func = (...args: Capable[]) =>
    new Promise((resolve, reject) => {
      const { port1: returnValueLocalPort, port2: returnValueRemotePort } = new MessageChannel()
      context.messagePorts.add(returnValueRemotePort)
      const callContext = recursiveBox([returnValueRemotePort, args] as const, context)
      ;(port as MessagePort).postMessage(callContext, getTransferableObjects(callContext))
      // Remove the remote port from the set after transfer (it's neutered now)
      context.messagePorts.delete(returnValueRemotePort)

      returnValueLocalPort.addEventListener('message', ({ data }: MessageEvent<Capable>) => {
        const result = recursiveRevive(data, context) as Promise<Capable>
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
  functionRegistry.register(func, { port: port as MessagePort }, func)

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

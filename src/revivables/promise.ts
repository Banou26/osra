import type { Capable } from '../types'
import type { RevivableContext } from './utils'
import type { StrictMessagePort } from '../utils/message-channel'
import type { UnderlyingType } from '.'

import { BoxBase } from './utils'
import { recursiveBox, recursiveRevive } from '.'
import { getTransferableObjects } from '../utils'
import { box as boxMessagePort, revive as reviveMessagePort, BoxedMessagePort } from './message-port'

export const type = 'promise' as const

export type Context =
  | { type: 'resolve', data: Capable }
  | { type: 'reject', error: string }

declare const ErrorMessage: unique symbol
declare const BadValueType: unique symbol
type CapablePromise<T> = T extends Promise<infer U>
  ? U extends Capable
    ? T
    : { [ErrorMessage]: 'Value type must extend a Promise that resolves to a Capable'; [BadValueType]: U }
  : { [ErrorMessage]: 'Value type must extend a Promise that resolves to a Capable'; [BadValueType]: T }

type ExtractCapable<T> = T extends Promise<infer U>
  ? U extends Capable ? U : never
  : never

const isCapablePromise = <T, U extends Capable = ExtractCapable<T>>(value: T): value is T & Promise<U> =>
  value instanceof Promise

export type BoxedPromise<T extends Capable = Capable> = {
  __OSRA_BOX__: 'revivable'
  type: typeof type
  port: ReturnType<typeof boxMessagePort>
  [UnderlyingType]: T
}

export const isType = (value: unknown): value is Promise<any> =>
  value instanceof Promise

export const box = <T, T2 extends RevivableContext>(
  value: CapablePromise<T>,
  context: T2
): BoxedPromise<ExtractCapable<T>> => {
  if (!isCapablePromise(value)) throw new TypeError('Expected Promise')
  const promise = value
  const { port1: localPort, port2: remotePort } = new MessageChannel()
  context.messagePorts.add(remotePort)

  const sendResult = (result: Context) => {
    const boxedResult = recursiveBox(result, context)
    localPort.postMessage(boxedResult, getTransferableObjects(boxedResult))
    localPort.close()
    // Clean up the remote port from the set (it was transferred earlier)
    context.messagePorts.delete(remotePort)
  }

  promise
    .then((data: ExtractCapable<T>) => sendResult({ type: 'resolve', data }))
    .catch((error: unknown) => sendResult({ type: 'reject', error: (error as Error)?.stack ?? String(error) }))

  return {
    ...BoxBase,
    type,
    port: boxMessagePort(remotePort as unknown as StrictMessagePort<string>, context)
  } as unknown as BoxedPromise<ExtractCapable<T>>
}

export const revive = <T extends BoxedPromise, T2 extends RevivableContext>(
  value: T,
  context: T2
) => {
  const port = reviveMessagePort(value.port as unknown as BoxedMessagePort<string>, context)
  context.messagePorts.add(port as MessagePort)
  return new Promise<T[UnderlyingType]>((resolve, reject) => {
    port.addEventListener('message', (event) => {
      const data = (event as unknown as MessageEvent<Context>).data
      const result = recursiveRevive(data, context) as Context
      if (result.type === 'resolve') {
        resolve(result.data as T[UnderlyingType])
      } else {
        reject(result.error)
      }
      context.messagePorts.delete(port as MessagePort)
      port.close()
    }, { once: true })
    port.start()
  })
}

const typeCheck = () => {
  const boxed = box(Promise.resolve(1 as const), {} as RevivableContext)
  const revived = revive(boxed, {} as RevivableContext)
  const expected: Promise<1> = revived
  // @ts-expect-error
  const notExpected: Promise<string> = revived
  // @ts-expect-error
  box(1 as const, {} as RevivableContext)
}

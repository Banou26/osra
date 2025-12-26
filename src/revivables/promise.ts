import type { Capable } from '../types'
import type { RevivableContext } from './utils'
import type { StrictMessagePort } from '../utils/message-channel'

import { BoxBase } from './utils'
import { recursiveBox, recursiveRevive } from '.'
import { getTransferableObjects } from '../utils'
import { box as boxMessagePort, revive as reviveMessagePort, BoxedMessagePort } from './message-port'

export const type = 'promise' as const

export type Context =
  | { type: 'resolve', data: Capable }
  | { type: 'reject', error: string }

declare const CapableError: unique symbol
type CapablePromise<T> = T extends Capable
  ? Promise<T>
  : { [CapableError]: 'Message type must extend Capable'; __badType__: T }

type ExtractCapable<T> = T extends Capable ? T : never

export type BoxedPromise<T extends Capable = Capable> = {
  __OSRA_BOX__: 'revivable'
  type: typeof type
  port: ReturnType<typeof boxMessagePort>
  __type__: T
}

export const isType = (value: unknown): value is Promise<any> =>
  value instanceof Promise

export const box = <T, T2 extends RevivableContext>(
  value: CapablePromise<T>,
  context: T2
) => {
  const promise = value as Promise<ExtractCapable<T>>
  const { port1: localPort, port2: remotePort } = new MessageChannel()
  context.messagePorts.add(remotePort)

  const sendResult = (result: Context) => {
    const boxedResult = recursiveBox(result, context)
    localPort.postMessage(boxedResult, getTransferableObjects(boxedResult))
    localPort.close()
  }

  promise
    .then((data: ExtractCapable<T>) => sendResult({ type: 'resolve', data }))
    .catch((error: unknown) => sendResult({ type: 'reject', error: (error as Error)?.stack ?? String(error) }))

  const result = {
    ...BoxBase,
    type,
    port: boxMessagePort(remotePort as unknown as StrictMessagePort<string>, context)
  }
  return result as typeof result & { __type__: Awaited<ExtractCapable<T>> }
}

export const revive = <T extends BoxedPromise, T2 extends RevivableContext>(
  value: T,
  context: T2
) => {
  const port = reviveMessagePort(value.port as unknown as BoxedMessagePort<string>, context)
  context.messagePorts.add(port as MessagePort)
  return new Promise<T['__type__']>((resolve, reject) => {
    port.addEventListener('message', (event) => {
      const data = (event as unknown as MessageEvent<Context>).data
      const result = recursiveRevive(data, context) as Context
      if (result.type === 'resolve') {
        resolve(result.data as T['__type__'])
      } else {
        reject(result.error)
      }
      port.close()
    }, { once: true })
    port.start()
  })
}

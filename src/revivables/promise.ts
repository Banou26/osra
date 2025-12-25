import type { Capable } from '../types'
import type { RevivableContext } from './utils'

import { BoxBase } from './utils'
import { recursiveBox, recursiveRevive } from '.'
import { getTransferableObjects } from '../utils'
import { StrictMessageChannel } from '../utils/message-channel'
import { box as boxMessagePort, revive as reviveMessagePort } from './message-port'

export const type = 'promise' as const

export type Context =
  | { type: 'resolve', data: Capable }
  | { type: 'reject', error: string }
  

declare const CapableError: unique symbol
type CapablePromise<T> = T extends Capable
  ? Promise<T>
  : { [CapableError]: 'Message type must extend Capable'; __badType__: T }


export const isType = (value: unknown): value is Promise<any> =>
  value instanceof Promise

export const box = <T, T2 extends RevivableContext>(
  value: CapablePromise<T>,
  context: T2
) => {
  const { port1: localPort, port2: remotePort } = new MessageChannel() as StrictMessageChannel<T, T>
  context.messagePorts.add(remotePort)

  const sendResult = (result: { type: 'resolve', data: Capable } | { type: 'reject', error: string }) => {
    const boxedResult = recursiveBox(result, context)
    localPort.postMessage(boxedResult, getTransferableObjects(boxedResult))
    localPort.close()
  }

  value
    .then(data => sendResult({ type: 'resolve', data }))
    .catch(error => sendResult({ type: 'reject', error: error?.stack ?? String(error) }))

  const result = {
    ...BoxBase,
    type,
    port: boxMessagePort(remotePort, context)
  }
  return result as typeof result & { __type__: Awaited<T> }
}

export const revive = <T extends ReturnType<typeof box>, T2 extends RevivableContext>(
  value: T,
  context: T2
) => {
  const port = reviveMessagePort(value.port, context)
  context.messagePorts.add(port)
  return new Promise<T['__type__']>((resolve, reject) => {
    port.addEventListener('message', ({ data }: MessageEvent<Context>) => {
      const result = recursiveRevive(data, context) as Context
      if (result.type === 'resolve') {
        resolve(result.data)
      } else {
        reject(result.error)
      }
      port.close()
    }, { once: true })
    port.start()
  })
}


const boxed = box(Promise.resolve(Symbol), {} as RevivableContext)

import type { Capable } from '../types'
import type { RevivableContext } from './utils'

import { BoxBase, recursiveBox, recursiveRevive } from '.'
import { getTransferableObjects } from '../utils'

export const type = 'promise' as const

export type Context =
  | { type: 'resolve', data: Capable }
  | { type: 'reject', error: string }

export const isType = (value: unknown): value is Promise<any> =>
  value instanceof Promise

export const box = <T extends RevivableContext>(
  value: Promise<any>,
  context: T
) => {
  const { port1: localPort, port2: remotePort } = new MessageChannel()
  context.messagePorts.add(remotePort)

  const sendResult = (result: { type: 'resolve', data: Capable } | { type: 'reject', error: string }) => {
    const boxedResult = recursiveBox(result, context)
    localPort.postMessage(boxedResult, getTransferableObjects(boxedResult))
    localPort.close()
  }

  value
    .then(data => sendResult({ type: 'resolve', data }))
    .catch(error => sendResult({ type: 'reject', error: error.stack }))

  return {
    ...BoxBase,
    type,
    port: remotePort
  }
}

export const revive = <T extends RevivableContext>(
  value: ReturnType<typeof box>,
  context: T
): Promise<any> => {
  context.messagePorts.add(value.port)
  return new Promise((resolve, reject) => {
    value.port.addEventListener('message', ({ data }: MessageEvent<Context>) => {
      const result = recursiveRevive(data, context) as Context
      if (result.type === 'resolve') {
        resolve(result.data)
      } else {
        reject(result.error)
      }
      value.port.close()
    }, { once: true })
    value.port.start()
  })
}

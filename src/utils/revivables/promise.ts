import type {
  Capable,
  RevivablePromise,
  RevivablePromiseContext,
  RevivableVariant
} from '../../types'
import type { ConnectionRevivableContext } from '../connection'

import { getTransferableObjects } from '../transferable'

export const name = 'promise'

export const is = (value: unknown): value is Promise<any> =>
  value instanceof Promise

export const box = (
  value: Promise<any>,
  context: ConnectionRevivableContext
): RevivableVariant & { type: 'promise' } => {
  const { port1: localPort, port2: remotePort } = new MessageChannel()
  context.messagePorts.add(remotePort)

  const sendResult = (result: { type: 'resolve', data: Capable } | { type: 'reject', error: string }) => {
    const boxedResult = context.recursiveBox(result, context)
    localPort.postMessage(boxedResult, getTransferableObjects(boxedResult))
    localPort.close()
  }

  value
    .then(data => sendResult({ type: 'resolve', data }))
    .catch(error => sendResult({ type: 'reject', error: error.stack }))

  return {
    type: 'promise',
    port: remotePort
  }
}

export const revive = (
  value: RevivablePromise,
  context: ConnectionRevivableContext
): Promise<any> => {
  context.messagePorts.add(value.port)
  return new Promise((resolve, reject) => {
    value.port.addEventListener('message', ({ data }:  MessageEvent<RevivablePromiseContext>) => {
      const result = context.recursiveRevive(data, context) as RevivablePromiseContext
      if (result.type === 'resolve') {
        resolve(result.data)
      } else { // result.type === 'reject'
        reject(result.error)
      }
      value.port.close()
    }, { once: true })
    value.port.start()
  })
}

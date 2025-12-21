import type { Capable } from '../../types'
import type { ConnectionRevivableContext } from '../connection'

import { OSRA_BOX } from '../../types'
import { getTransferableObjects } from '../transferable'

export const type = 'promise' as const

export type Source = Promise<any>

export type Boxed = {
  type: typeof type
  port: MessagePort
}

export type Box = { [OSRA_BOX]: 'revivable' } & Boxed

// Context type for promise resolution messages
export type Context =
  | { type: 'resolve', data: Capable }
  | { type: 'reject', error: string }

export const is = (value: unknown): value is Source =>
  value instanceof Promise

export const isBox = (value: unknown): value is Box =>
  value !== null &&
  typeof value === 'object' &&
  OSRA_BOX in value &&
  (value as Record<string, unknown>)[OSRA_BOX] === 'revivable' &&
  (value as Record<string, unknown>).type === type

export const shouldBox = (_value: Source, _context: ConnectionRevivableContext): boolean =>
  true

export const box = (
  value: Source,
  context: ConnectionRevivableContext
): Boxed => {
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
    type,
    port: remotePort
  }
}

export const revive = (
  value: Boxed,
  context: ConnectionRevivableContext
): Source => {
  context.messagePorts.add(value.port)
  return new Promise((resolve, reject) => {
    value.port.addEventListener('message', ({ data }:  MessageEvent<Context>) => {
      const result = context.recursiveRevive(data, context) as Context
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

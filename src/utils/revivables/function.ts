import type { Capable } from '../../types'
import type { ConnectionRevivableContext } from '../connection'

import { isRevivablePromiseBox } from '../type-guards'
import { getTransferableObjects } from '../transferable'

export const type = 'function' as const

export type Source = Function

export type Boxed = {
  type: typeof type
  port: MessagePort
}

// Context type for function call messages
export type CallContext = [
  /** MessagePort that will be used to send the result of the function call */
  MessagePort,
  /** Arguments that will be passed to the function call */
  Capable[]
]

export const is = (value: unknown): value is Source =>
  typeof value === 'function'

export const shouldBox = (_value: Source, _context: ConnectionRevivableContext): boolean =>
  true

export const box = (
  value: Source,
  context: ConnectionRevivableContext
): Boxed => {
  const { port1: localPort, port2: remotePort } = new MessageChannel()
  context.messagePorts.add(remotePort)
  localPort.addEventListener('message', ({ data }:  MessageEvent<CallContext>) => {
    const [returnValuePort, args] = context.recursiveRevive(data, context) as CallContext
    const result = (async () => value(...args))()
    const boxedResult = context.recursiveBox(result, context)
    returnValuePort.postMessage(boxedResult, getTransferableObjects(boxedResult))
  })
  localPort.start()

  return {
    type,
    port: remotePort
  }
}

export const revive = (
  value: Boxed,
  context: ConnectionRevivableContext
): Source => {
  const func = (...args: Capable[]) =>
    new Promise((resolve, reject) => {
      const { port1: returnValueLocalPort, port2: returnValueRemotePort } = new MessageChannel()
      context.messagePorts.add(returnValueRemotePort)
      const callContext = context.recursiveBox([returnValueRemotePort, args] as const, context)
      value.port.postMessage(callContext, getTransferableObjects(callContext))

      returnValueLocalPort.addEventListener('message', ({ data }: MessageEvent<Capable>) => {
        if (!isRevivablePromiseBox(data)) throw new Error(`Proxied function did not return a promise`)
        const result = context.recursiveRevive(data, context) as Promise<Capable>
        result
          .then(resolve)
          .catch(reject)
          .finally(() => returnValueLocalPort.close())
      })
      returnValueLocalPort.start()
    })

  return func
}

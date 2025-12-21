import type { Capable } from '../../types'

import { getTransferableObjects } from '../transferable'
import * as promise from './promise'
import { ConnectionRevivableContext } from '../utils'
import { BoxBase } from '.'

export const type = 'function' as const

// Context type for function call messages
export type CallContext = [
  /** MessagePort that will be used to send the result of the function call */
  MessagePort,
  /** Arguments that will be passed to the function call */
  Capable[]
]

export const isType = <T extends Function>(value: unknown): value is T =>
  typeof value === 'function'

export const box = <T extends Function, T2 extends ConnectionRevivableContext>(
  value: T,
  context: T2
) => {
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
    ...BoxBase,
    type,
    port: remotePort
  }
}

type FunctionBox = ReturnType<typeof box>

export const revive = <T extends Function>(
  value: FunctionBox,
  context: ConnectionRevivableContext
): T => {
  const func = (...args: Capable[]) =>
    new Promise((resolve, reject) => {
      const { port1: returnValueLocalPort, port2: returnValueRemotePort } = new MessageChannel()
      context.messagePorts.add(returnValueRemotePort)
      const callContext = context.recursiveBox([returnValueRemotePort, args] as const, context)
      value.port.postMessage(callContext, getTransferableObjects(callContext))

      returnValueLocalPort.addEventListener('message', ({ data }: MessageEvent<Capable>) => {
        if (!promise.isBox(data)) throw new Error(`Proxied function did not return a promise`)
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
import type { Capable } from '../types'
import type { RevivableContext } from './utils'

import { BoxBase, recursiveBox, recursiveRevive } from '.'
import { getTransferableObjects } from '../utils'

export const type = 'function' as const

export type CallContext = [
  /** MessagePort that will be used to send the result of the function call */
  MessagePort,
  /** Arguments that will be passed to the function call */
  Capable[]
]

export const isType = <T extends Function>(value: unknown): value is T =>
  typeof value === 'function'

export const box = <T extends Function, T2 extends RevivableContext>(
  value: T,
  context: T2
) => {
  const { port1: localPort, port2: remotePort } = new MessageChannel()
  context.messagePorts.add(remotePort)

  localPort.addEventListener('message', ({ data }: MessageEvent<CallContext>) => {
    const [returnValuePort, args] = recursiveRevive(data, context) as CallContext
    const result = (async () => value(...args))()
    const boxedResult = recursiveBox(result, context)
    returnValuePort.postMessage(boxedResult, getTransferableObjects(boxedResult))
  })
  localPort.start()

  return {
    ...BoxBase,
    type,
    port: remotePort
  }
}

export const revive = <T extends Function, T2 extends RevivableContext>(
  value: ReturnType<typeof box>,
  context: T2
): T => {
  const func = (...args: Capable[]) =>
    new Promise((resolve, reject) => {
      const { port1: returnValueLocalPort, port2: returnValueRemotePort } = new MessageChannel()
      context.messagePorts.add(returnValueRemotePort)
      const callContext = recursiveBox([returnValueRemotePort, args] as const, context)
      value.port.postMessage(callContext, getTransferableObjects(callContext))

      returnValueLocalPort.addEventListener('message', ({ data }: MessageEvent<Capable>) => {
        const result = recursiveRevive(data, context) as Promise<Capable>
        result
          .then(resolve)
          .catch(reject)
          .finally(() => returnValueLocalPort.close())
      })
      returnValueLocalPort.start()
    })

  return func as unknown as T
}

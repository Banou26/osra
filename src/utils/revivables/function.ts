import type {
  Capable,
  RevivableFunction,
  RevivableFunctionCallContext,
  RevivableVariant
} from '../../types'
import type { ConnectionRevivableContext } from '../connection'

import { isRevivablePromiseBox } from '../type-guards'
import { getTransferableObjects } from '../transferable'

export const name = 'function'

export const is = (value: unknown): value is Function =>
  typeof value === 'function'

export const box = (
  value: Function,
  context: ConnectionRevivableContext,
  recursiveBox: (value: Capable, context: ConnectionRevivableContext) => Capable,
  recursiveRevive: (value: Capable, context: ConnectionRevivableContext) => Capable
): RevivableVariant & { type: 'function' } => {
  const { port1: localPort, port2: remotePort } = new MessageChannel()
  context.messagePorts.add(remotePort)
  localPort.addEventListener('message', ({ data }:  MessageEvent<RevivableFunctionCallContext>) => {
    const [returnValuePort, args] = recursiveRevive(data, context) as RevivableFunctionCallContext
    const result = (async () => value(...args))()
    const boxedResult = recursiveBox(result, context)
    returnValuePort.postMessage(boxedResult, getTransferableObjects(boxedResult))
  })
  localPort.start()

  return {
    type: 'function',
    port: remotePort
  }
}

export const revive = (
  value: RevivableFunction,
  context: ConnectionRevivableContext,
  recursiveBox: (value: Capable, context: ConnectionRevivableContext) => Capable,
  recursiveRevive: (value: Capable, context: ConnectionRevivableContext) => Capable
): Function => {
  const func = (...args: Capable[]) =>
    new Promise((resolve, reject) => {
      const { port1: returnValueLocalPort, port2: returnValueRemotePort } = new MessageChannel()
      context.messagePorts.add(returnValueRemotePort)
      const callContext = recursiveBox([returnValueRemotePort, args] as const, context)
      value.port.postMessage(callContext, getTransferableObjects(callContext))

      returnValueLocalPort.addEventListener('message', ({ data }: MessageEvent<Capable>) => {
        if (!isRevivablePromiseBox(data)) throw new Error(`Proxied function did not return a promise`)
        const result = recursiveRevive(data, context) as Promise<Capable>
        result
          .then(resolve)
          .catch(reject)
          .finally(() => returnValueLocalPort.close())
      })
      returnValueLocalPort.start()
    })

  return func
}

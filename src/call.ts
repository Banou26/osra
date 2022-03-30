import type { Target, Resolvers, Resolver } from './types'

import { MESSAGE_SOURCE_KEY } from './shared'
import { getTransferableObjects, makeObjectProxiedFunctions, proxyObjectFunctions } from './utils'

/**
 * Call a function with the provided arguments and get its return value back
 */
export const call =
 <T extends Resolvers>(target: Target, { key = MESSAGE_SOURCE_KEY }: { key?: string } = { key: MESSAGE_SOURCE_KEY }) =>
   <T2 extends keyof T>(type: T2, data?: Parameters<T[T2]>[0]): Promise<Awaited<ReturnType<T[T2]>>> =>
    new Promise(resolve => {
      const { port1, port2 } = new MessageChannel()

      port1.addEventListener(
        'message',
        ({ data }) => {
          const proxiedData = makeObjectProxiedFunctions(data)
          console.log('call message', proxiedData)
          resolve(proxiedData)
          port1.close()
          port2.close()
        },
        { once: true }
      )
      port1.start()
      const proxiedData = proxyObjectFunctions(data)
      const transferables = getTransferableObjects(proxiedData)
      console.log('call', proxiedData)
      target.postMessage(
        {
          source: key,
          type,
          data,
          port: port2
        },
        {
          targetOrigin: '*',
          transfer: [port2, ...transferables as unknown as Transferable[] ?? []]
        }
      )
    })

/**
 * Make a listener for a call
 */
export const makeCallListener =
  <T extends Resolver>(func: T) =>
    // @ts-ignore
    async (data: Parameters<T>[0], { port, ...rest }: Parameters<T>[1]): Promise<Awaited<ReturnType<T>>> => {
      const proxiedData = makeObjectProxiedFunctions(data)
      // @ts-ignore
      const result = await func(proxiedData, { port, ...rest })
      const proxyData = proxyObjectFunctions(result)
      const transferables = getTransferableObjects(proxyData)
      console.log('makeCallListener', proxyData, func)
      port.postMessage(proxyData, { transfer: transferables as unknown as Transferable[] })
      port.close()
      // This returns the result value for typing reasons, the actual value isn't useable as transferables cannot be used.
      return proxyData
    }

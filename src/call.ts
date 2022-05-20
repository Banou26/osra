import type { Target, Resolvers, Resolver } from './types'

import { MESSAGE_SOURCE_KEY } from './shared'
import { getTransferableObjects, makeObjectProxiedFunctions, proxyObjectFunctions } from './utils'

/**
 * Call a function with the provided arguments and get its return value back
 */
export const call =
 <T extends Resolvers>(target: Target, { key = MESSAGE_SOURCE_KEY }: { key?: string } = { key: MESSAGE_SOURCE_KEY }) =>
   <T2 extends keyof T>(type: T2, data?: Parameters<T[T2]>[0]): Promise<Awaited<ReturnType<T[T2]>>> =>
    new Promise((resolve, reject) => {
      const { port1, port2 } = new MessageChannel()

      port1.addEventListener(
        'message',
        ({ data }) => {
          if (data.error) {
            reject(data.error)
          } else {
            const proxiedData = makeObjectProxiedFunctions(data.result)
            resolve(proxiedData)
          }
          port1.close()
          port2.close()
        },
        { once: true }
      )
      port1.start()
      const proxiedData = proxyObjectFunctions(data)
      const transferables = getTransferableObjects(proxiedData)
      target.postMessage(
        {
          source: key,
          type,
          data: proxiedData,
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
    async (data: Parameters<T>[0], extra: Parameters<T>[1]): Promise<Awaited<ReturnType<T>>> => {
      const { port } = extra
      const proxiedData = makeObjectProxiedFunctions(data)
      try {
        const result = await func(proxiedData, extra)
        const proxyData = proxyObjectFunctions(result)
        const transferables = getTransferableObjects(proxyData)
        port.postMessage({ result: proxyData }, { transfer: transferables as unknown as Transferable[] })
        port.close()
        // This returns the result value for typing reasons, the actual value isn't useable as transferables cannot be used.
        return result
      } catch (error) {
        port.postMessage({ error })
        port.close()
        throw error
      }
    }

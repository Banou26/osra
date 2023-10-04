import type { Target, Resolvers, ApiResolverOptions, StructuredCloneTransferableObject, StructuredCloneTransferableType, RestrictedParametersType } from './types'

import { MESSAGE_SOURCE_KEY } from './shared'
import { getTransferableObjects, makeObjectProxiedFunctions, proxyObjectFunctions } from './utils'

/**
 * Call a function with the provided arguments and get its return value back
 */
export const call =
 <T2 extends Resolvers>(target: Target, { key = MESSAGE_SOURCE_KEY }: { key?: string } = { key: MESSAGE_SOURCE_KEY }) =>
   <T3 extends keyof T2>(type: T3, data?: Parameters<T2[T3]>[0]): Promise<Awaited<ReturnType<T2[T3]>>> =>
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
<T extends (data: any, extra: ApiResolverOptions) => unknown>(func: T) =>
    (async (data: RestrictedParametersType<T>, extra: ApiResolverOptions): Promise<Awaited<ReturnType<T>>> => {
      const { port } = extra
      const proxiedData = makeObjectProxiedFunctions(data) as Parameters<T>[0]
      try {
        const result = await func(proxiedData, extra)
        const proxyData = proxyObjectFunctions(result)
        const transferables = getTransferableObjects(proxyData)
        port.postMessage({ result: proxyData }, { transfer: transferables as unknown as Transferable[] })
        port.close()
        // This returns the result value for typing reasons, the actual value isn't useable as transferables cannot be used.
        return result as Awaited<ReturnType<T>>
      } catch (error) {
        port.postMessage({ error })
        port.close()
        throw error
      }
    }) as unknown as T

/**
 * Make a listener for a call
 */
export const makeProxyCallListener =
<T extends (data: any, extra: ApiResolverOptions) => unknown>(
  target: Target,
  { key = MESSAGE_SOURCE_KEY }: { key?: string } = { key: MESSAGE_SOURCE_KEY }
) =>
    ((data: RestrictedParametersType<T>, extra: ApiResolverOptions): Promise<Awaited<ReturnType<T>>> => {
      const { type, port } = extra
      const transferables = getTransferableObjects(data)
      target.postMessage(
        {
          source: key,
          type,
          data,
          port
        },
        {
          targetOrigin: '*',
          transfer: [port, ...transferables as unknown as Transferable[] ?? []]
        }
      )
      return undefined as unknown as Promise<Awaited<ReturnType<T>>>
    }) as unknown as T

import type { Target, OsraMessage, RestrictedParametersType, ValidatedResolvers, Resolver } from './types'

import { MESSAGE_SOURCE_KEY } from './shared'
import { getTransferableObjects, makeObjectProxiedFunctions, proxyObjectFunctions } from './utils'

/**
 * Call a function with the provided arguments and get its return value back
 */
export const call =
  <T2 extends ValidatedResolvers>(target: Target, { key = MESSAGE_SOURCE_KEY }: { key?: string } = { key: MESSAGE_SOURCE_KEY }) =>
    <T3 extends keyof T2>(type: T3, ...data: Parameters<ReturnType<T2[T3]>>): Promise<Awaited<ReturnType<ReturnType<T2[T3]>>>> =>
      new Promise((resolve, reject) => {
        const { port1: localPort, port2: remotePort } = new MessageChannel()

        localPort.addEventListener(
          'message',
          ({ data }) => {
            if (data.error) {
              reject(data.error)
            } else {
              const proxiedData = makeObjectProxiedFunctions(data.result)
              resolve(proxiedData)
            }
            localPort.close()
            remotePort.close()
          },
          { once: true }
        )
        localPort.start()
        const proxiedData = proxyObjectFunctions(data)
        const transferables = getTransferableObjects(proxiedData)
        target.postMessage(
          {
            source: key,
            type,
            data: proxiedData,
            port: remotePort
          },
          {
            targetOrigin: '*',
            transfer: [remotePort, ...transferables as unknown as Transferable[] ?? []]
          }
        )
      })

/**
 * Make a listener for a call
 */
export const makeCallListener =
  <T extends Resolver>(func: T) =>
    ((extra: OsraMessage) => 
      async (...data: RestrictedParametersType<(extra: OsraMessage) => T>[]): Promise<Awaited<ReturnType<T>>> => {
        const { port } = extra
        const proxiedData = makeObjectProxiedFunctions(data) as Parameters<T>
        try {
          const result = await func(...proxiedData)
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
      }) as (extra: OsraMessage) => (...data: Parameters<T>) => Promise<Awaited<ReturnType<T>>>

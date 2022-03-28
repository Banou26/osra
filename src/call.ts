import type { Target, Resolvers, Resolver } from './types'

import { MESSAGE_SOURCE_KEY } from './shared'

/**
 * Call a function with the provided arguments and get its return value back
 */
export const call =
 <T extends Resolvers>(target: Target, { key = MESSAGE_SOURCE_KEY }: { key?: string } = { key: MESSAGE_SOURCE_KEY }) =>
   <T2 extends keyof T>(type: T2, data?: Parameters<T[T2]>[0], transfer: Transferable[] = []): Promise<Awaited<ReturnType<T[T2]>>> =>
   new Promise(resolve => {
     const { port1, port2 } = new MessageChannel()

     port1.addEventListener(
       'message',
       ({ data }) => {
         resolve(data)
         port1.close()
         port2.close()
       },
       { once: true }
     )
     port1.start()

     target.postMessage(
       {
         source: key,
         type,
         data,
         port: port2
       },
       {
         targetOrigin: '*',
         transfer: [port2, ...transfer ?? []]
       }
     )
   })

/**
 * Make a listener for a call
 */
export const makeCallListener =
  <T extends Resolver>(func: T) =>
    async (data: Parameters<T>[0], { port, ...rest }: Parameters<T>[1]): Promise<Awaited<ReturnType<T>>> => {
      const res = await func(data, { port, ...rest })
      const [result, transferables] =
        Array.isArray(res)
          ? res
          : [res, undefined]
      if (Array.isArray(result)) {
        port.postMessage(result[0], <Transferable[]>result[1])
      } else {
        port.postMessage(result)
      }
      port.close()
      // This returns the result value for typing reasons, the actual value isn't useable as transferables cannot be used.
      return result
    }

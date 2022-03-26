import type { Resolvers, Await } from '@mfkn/fkn-web'

/**
 * Call a host API function and get its return value back
 */
export const call =
  <T extends keyof Resolvers>(type: T, data?: Parameters<Resolvers[T]>[0]['data'], transfer: Transferable[] = []): Promise<Await<ReturnType<Resolvers[T]>>> =>
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

      window.parent.postMessage(
        {
          source: 'oz-package-api',
          type,
          data,
          port: port2
        },
        '*',
        [port2, ...transfer ?? []]
      )
    })

/**
 * Call a package function and get its return value back
 */
export const makeCallListener =
  <T = any, U = any>(func: (data) => U | [U, any]) =>
    async ({ port, data }: { port: MessagePort, data: T }) => {
      const res = await func(data)
      const [result, transferables] =
        Array.isArray(res)
          ? res
          : [res, undefined]

      port.postMessage(
        result,
        transferables
      )
      port.close()
    }

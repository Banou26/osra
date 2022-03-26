import type { Resolvers } from '@mfkn/fkn-web'
import makeEventTarget from '@mfkn/fkn-web/src/api/utils/event-target'

/**
 * Call a host API function
 */
export const makeEventChannelCall = (type: keyof Resolvers, data?: any, transfer: Transferable[] = []) => {
  const events = makeEventTarget()
  const { port1, port2 } = new MessageChannel()

  port1.addEventListener(
    'message',
    ({ data: { type, data } }) => events.dispatch(type, data)
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

  return {
    send: (type: string, data?: any, transfer: Transferable[] = []) => port1.postMessage({ type, data }, transfer),
    events,
    port1,
    port2
  }
}

/**
 * Call a package function and get its return value back
 */
export const makeEventChannelListener =
  <T = any, U = any>(func: (data) => U | [U, any]) =>
    async ({ port, data }: { port: MessagePort, data: T }) => {
      const events = makeEventTarget()
      port.addEventListener(
        'message',
        ({ type, data }) => events.dispatch(type, data)
      )
      const res = await func({
        send: (data?: any, transfer: Transferable[] = []) => port.postMessage(data, transfer),
        events,
        data
      })
      const [result, transferables] =
        Array.isArray(res)
          ? res
          : [res, undefined]
      port.postMessage(result, transferables)
    }

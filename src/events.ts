import makeEventTarget from './event-target'



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



/**
 * Call a host API function
 */
 export const makeEventChannel = (port: MessagePort) => {
  const events = makeEventTarget()

  port.addEventListener(
    'message',
    ({ data: { type, data } }) => events.dispatch(type, data)
  )
  port.start()

  return {
    send: (type: string, data?: any, transfer: Transferable[] = []) => port.postMessage({ type, data }, transfer),
    events
  }
}

// /**
//  * Call a host API function
//  */
// export const makeEventChannelCall = (type: InstalledPackage, data?: any, transfer: Transferable[] = []) => {
//   // const events = makeEventTarget()
//   // const { port1, port2 } = new MessageChannel()

//   // port1.addEventListener(
//   //   'message',
//   //   ({ type, data }) => events.dispatch(type, data)
//   // )
//   // port1.start()

//   // window.parent.postMessage(
//   //   {
//   //     source: 'oz-package-api',
//   //     type,
//   //     data,
//   //     port: port2
//   //   },
//   //   '*',
//   //   [port2, ...transfer ?? []]
//   // )
//   // return {
//   //   send: (type: Api, data?: any, transfer: Transferable[] = []) => send(port1, { type, data }, transfer),
//   //   events,
//   //   port1,
//   //   port2
//   // }
// }

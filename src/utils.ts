import type { OsraMessage, Resolvers, StructuredCloneTransferableType, Target, TransferableObject } from './types'

export const isClonable = (value: any) =>
  globalThis.SharedArrayBuffer && value instanceof globalThis.SharedArrayBuffer ? true
  : false

export const isTransferable = (value: any) =>
  globalThis.ArrayBuffer && value instanceof globalThis.ArrayBuffer ? true
  : globalThis.MessagePort && value instanceof globalThis.MessagePort ? true
  : globalThis.ReadableStream && value instanceof globalThis.ReadableStream ? true
  : globalThis.WritableStream && value instanceof globalThis.WritableStream ? true
  : globalThis.TransformStream && value instanceof globalThis.TransformStream ? true
  : globalThis.ImageBitmap && value instanceof globalThis.ImageBitmap ? true
  : false

export const getTransferableObjects = (value: any): TransferableObject[] => {
  const transferables: TransferableObject[] = []
  const recurse = (value: any) => 
    isClonable(value) ? undefined
    : isTransferable(value) ? transferables.push(value)
    : Array.isArray(value) ? value.map(recurse)
    : value && typeof value === 'object' ? Object.values(value).map(recurse)
    : undefined

  recurse(value)
  return transferables
}

export const PROXY_FUNCTION_PROPERTY = '__proxyFunctionPort__'
export const PROXY_MESSAGE_CHANNEL_PROPERTY = '__proxyMessageChannelPort__'
export const OSRA_PROXIED = '__OSRA_PROXIED__'

export const makeProxyFunction = (func) => {
  const { port1, port2 } = new MessageChannel()
  port1.addEventListener('message', async (ev) => {
    try {
      const result = await func(...ev.data)
      const proxiedResult = proxyObjectFunctions(result)
      const transferables = getTransferableObjects(proxiedResult)
      port1.postMessage({ result: proxiedResult }, { transfer: transferables as unknown as Transferable[] })
    } catch (err) {
      port1.postMessage({ error: err })
    }
    // Keep the port open, the function might be called many times.
  })
  port1.start()
  return port2
}

export const proxyObjectFunctions = (value: any) =>
  isClonable(value) ? value
  : isTransferable(value) ? value
  : typeof value === 'function' ? ({ [PROXY_FUNCTION_PROPERTY]: makeProxyFunction(value) })
  : Array.isArray(value) ? value.map(proxyObjectFunctions)
  : value && typeof value === 'object' ? (
    Object.fromEntries(
      Object
        .entries(value)
        .map(([key, value]) => [
          key,
          proxyObjectFunctions(value)
        ])
    )
  )
  : value

// todo: implement reject
export const makeProxiedFunction =
  (port: MessagePort) =>
    (...args) =>
      new Promise((resolve, reject) => {
        const proxiedArguments = proxyObjectFunctions(args)
        const transferables = getTransferableObjects(proxiedArguments)
        const listener = (ev) => {
          if (ev.data.error) reject(ev.data.error)
          else resolve(makeObjectProxiedFunctions(ev.data.result))
          port.removeEventListener('message', listener)
        }
        port.addEventListener('message', listener)
        port.start()
        port.postMessage(proxiedArguments, { transfer: transferables as unknown as Transferable[] })
      })

export const makeObjectProxiedFunctions = (value: any) =>
  isClonable(value) ? value
  : isTransferable(value) ? value
  : value && typeof value === 'object' && value[PROXY_FUNCTION_PROPERTY] ? makeProxiedFunction(value[PROXY_FUNCTION_PROPERTY])
  : Array.isArray(value) ? value.map(makeObjectProxiedFunctions)
  : value && typeof value === 'object' ? (
    Object.fromEntries(
      Object
        .entries(value)
        .map(([key, value]) => [
          key,
          makeObjectProxiedFunctions(value)
        ])
    )
  )
  : value

export const makeProxyFunction = (func) => {
  const { port1, port2 } = new MessageChannel()
  port1.addEventListener('message', async (ev) => {
    try {
      const result = await func(...ev.data)
      const proxiedResult = proxyObjectFunctions(result)
      const transferables = getTransferableObjects(proxiedResult)
      port1.postMessage({ result: proxiedResult }, { transfer: transferables as unknown as Transferable[] })
    } catch (err) {
      port1.postMessage({ error: err })
    }
    // Keep the port open, the function might be called many times.
  })
  port1.start()
  return port2
}

// export const replaceOutgoingProxiedTypes = (value: any) =>
//   isClonable(value) ? value
//   : isTransferable(value) ? value
//   : typeof value === 'function' ? ({ [PROXY_FUNCTION_PROPERTY]: makeProxyFunction(value) })
//   : Array.isArray(value) ? value.map(proxyObjectFunctions)
//   : value && typeof value === 'object' ? (
//     Object.fromEntries(
//       Object
//         .entries(value)
//         .map(([key, value]) => [
//           key,
//           proxyObjectFunctions(value)
//         ])
//     )
//   )
//   : value

type ProxiedType =
  {
    type: Function,
    name: 'function'
  }
  | {
    type: MessagePort,
    name: 'messagePort'
  }
  | {
    type: Promise<any>,
    name: 'promise'
  }
  | {
    type: ReadableStream,
    name: 'readableStream'
  }

export const getProxiedType = (value: any): ProxiedType => {
  if (typeof value === 'function') return { type: value, name: 'function' }
  if (value instanceof MessagePort) return { type: value, name: 'messagePort' }
  if (value instanceof Promise) return { type: value, name: 'promise' }
  if (value instanceof ReadableStream) return { type: value, name: 'readableStream' }
  throw new Error(`Unknown proxied type: ${value}`)
}



export const replaceIncomingFunction =
  ({ port, replaceFunction }: { port: OsraMessagePort, replaceFunction: (port: OsraMessagePort) => Function }) =>
    (...args) =>
      new Promise((resolve, reject) => {
        const proxiedArguments = proxyObjectFunctions(args)
        const transferables = getTransferableObjects(proxiedArguments)
        const listener = (ev) => {
          if (ev.data.error) reject(ev.data.error)
          else resolve(replaceRecursive(ev.data.result))
          port.removeEventListener('message', listener)
        }
        port.addEventListener('message', listener)
        port.start()
        port.postMessage(proxiedArguments, { transfer: transferables as unknown as Transferable[] })
      })


// export const makeProxiedFunction =
//   (port: MessagePort) =>
//     (...args) =>
//       new Promise((resolve, reject) => {
//         const proxiedArguments = proxyObjectFunctions(args)
//         const transferables = getTransferableObjects(proxiedArguments)
//         const listener = (ev) => {
//           if (ev.data.error) reject(ev.data.error)
//           else resolve(makeObjectProxiedFunctions(ev.data.result))
//           port.removeEventListener('message', listener)
//         }
//         port.addEventListener('message', listener)
//         port.start()
//         port.postMessage(proxiedArguments, { transfer: transferables as unknown as Transferable[] })
//       })

export const replaceIncomingProxiedTypes = <T extends StructuredCloneTransferableType>(
  value: T,
  { finalizationRegistry }: { finalizationRegistry: FinalizationRegistry<string> }
): T =>
  replaceRecursive(
    value,
    (value) => Boolean(
      value && typeof value === 'object' && OSRA_PROXIED in value && value[OSRA_PROXIED]
    ),
    (port: OsraMessagePort) => {
      if (port.type === 'function') {
        const proxiedFunction = (...args: (StructuredCloneTransferableType)[]) =>
          new Promise((resolve, reject) => {
            const proxiedArgs = replaceIncomingProxiedTypes(args, { finalizationRegistry })

          })

        if (!(port instanceof MessagePort)) {
          finalizationRegistry.register(proxiedFunction, (port as OsraMessagePort).channelPortId)
        }

        return proxiedFunction
      }
      throw new Error(`Unknown incoming proxied type: ${value}`)
    })

export const replaceOutgoingProxiedTypes = <T extends StructuredCloneTransferableType>(value: T) =>
  replaceRecursive(
    value,
    (value) => typeof value === 'function',
    (value) => {
      if (typeof value === 'function') {
        const func = value as Function
        const { port1, port2 } = makeOsraMessageChannel('', 'function')
        port1.addEventListener('message', async (ev) => {
          try {
            const result = await func(...ev.data)
            const proxiedResult = proxyObjectFunctions(result)
            const transferables = getTransferableObjects(proxiedResult)
            port1.postMessage({ result: proxiedResult }, { transfer: transferables as unknown as Transferable[] })
          } catch (err) {
            port1.postMessage({ error: err })
          }
          // Keep the port open, the function might be called many times.
        })
        port1.start()
        return port2
      }
      throw new Error(`Unknown outgoing proxied type: ${value}`)
    }
  )

export const replaceRecursive = <
  T extends StructuredCloneTransferableType,
  T2 extends (value: any) => any
>(
  value: T,
  shouldReplace: (value: Parameters<T2>[0]) => boolean,
  replaceFunction: T2
) =>
  isClonable(value) ? value
  : isTransferable(value) ? value
  : shouldReplace(value) ? replaceFunction(value)
  : Array.isArray(value) ? value.map(value => replaceRecursive(value, shouldReplace, replaceFunction))
  : value && typeof value === 'object' ? (
    Object.fromEntries(
      Object
        .entries(value)
        .map(([key, value]) => [
          key,
          replaceRecursive(value, shouldReplace, replaceFunction)
        ])
    )
  )
  : value

export const proxyMessage = ({ key, target }: { key: string, target: Target }, event: MessageEvent<OsraMessage<Resolvers>>) => {
  const { type, data, port } = event.data
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
}

export const makeNumberAllocator = () => {
  let highest = 0
  const freedUnused = new Set<number>()
  return {
    alloc: () => {
      if (freedUnused.size > 0) {
        const number = freedUnused.values().next().value
        if (number === undefined) {
          throw new Error(`Tried to allocate number from freedUnused but result was undefined`)
        }
        freedUnused.delete(number)
        return number
      }
      highest++
      return highest
    },
    free: (number) => {
      freedUnused.add(number)
    }
  }
}

type NumberAllocator = ReturnType<typeof makeNumberAllocator>

export const makeAllocator = <T>({ numberAllocator }: { numberAllocator: NumberAllocator }) => {
  const channels = new Map<number, T>()

  const alloc = (value: T) => {
    const id = numberAllocator.alloc()
    channels.set(id, value)
    return id
  }
  const get = (id: number) => channels.get(id)
  const free = (id: number) => {
    channels.delete(id)
    numberAllocator.free(id)
  }

  return {
    alloc,
    get,
    free
  }
}
type Allocator<T> = ReturnType<typeof makeAllocator<T>>

type OsraMessageChannelAllocator = Allocator<() => any>

export type SerializedOsraMessagePort = {
  [OSRA_PROXIED]: true,
  channelPortId: string,
  type: string
  data?: any
}

export type OsraMessagePort =
  MessagePort
  & SerializedOsraMessagePort
  & { toJSON: () => SerializedOsraMessagePort }

export const makeOsraMessageChannel = (channelPortId: string, type: string) => {
  const { port1: _port1, port2: _port2 } = new MessageChannel()

  const makeOsraMessagePort = (port: MessagePort) => {
    const osraMessagePort = port as OsraMessagePort
    osraMessagePort.channelPortId = channelPortId
    osraMessagePort.toJSON = () => ({ [OSRA_PROXIED]: true, channelPortId, type })
    return osraMessagePort
  }

  const port1 = makeOsraMessagePort(_port1)
  const port2 = makeOsraMessagePort(_port2)

  return {
    port1,
    port2
  }
}

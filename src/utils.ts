import type { ApiMessageData, Resolvers, Target, TransferableObject } from './types'

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

export const proxyMessage = ({ key, target }: { key: string, target: Target }, event: MessageEvent<ApiMessageData<Resolvers>>) => {
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

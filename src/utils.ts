import { TransferableObject } from './types'

const isTransferable = (value: any) =>
  globalThis.ArrayBuffer && value instanceof globalThis.ArrayBuffer ? true :
  globalThis.MessagePort && value instanceof globalThis.MessagePort ? true :
  globalThis.ReadableStream && value instanceof globalThis.ReadableStream ? true :
  globalThis.WritableStream && value instanceof globalThis.WritableStream ? true :
  globalThis.TransformStream && value instanceof globalThis.TransformStream ? true :
  globalThis.ImageBitmap && value instanceof globalThis.ImageBitmap ? true :
  false

export const getTransferableObjects = (value: any): TransferableObject[] => {
  const transferables: TransferableObject[] = []
  const recurse = (value: any) => 
    isTransferable(value) ? transferables.push(value) :
    Array.isArray(value) ? value.map(recurse) :
    value && typeof value === 'object' ? Object.values(value).map(recurse) :
    undefined

  recurse(value)
  return transferables
}

const PROXY_FUNCTION_PROPERTY = '__proxyFunctionPort__'

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
    port1.close()
    port2.close()
  })
  port1.start()
  return port2
}

export const proxyObjectFunctions = (value: any) =>
  isTransferable(value) ? value :
  typeof value === 'function' ? ({ [PROXY_FUNCTION_PROPERTY]: makeProxyFunction(value) }) :
  Array.isArray(value) ? value.map(proxyObjectFunctions) :
  value && typeof value === 'object' ? (
    Object.fromEntries(
      Object
        .entries(value)
        .map(([key, value]) => [
          key,
          proxyObjectFunctions(value)
        ])
    )
  ) :
  value

// todo: implement reject
export const makeProxiedFunction =
  (port: MessagePort) =>
    (...args) =>
      new Promise((resolve, reject) => {
        const proxiedArguments = proxyObjectFunctions(args)
        const transferables = getTransferableObjects(proxiedArguments)
        port.addEventListener('message', (ev) => {
          if (ev.data.error) reject(ev.data.error)
          else resolve(makeObjectProxiedFunctions(ev.data.result))
        })
        port.start()
        port.postMessage(proxiedArguments, { transfer: transferables as unknown as Transferable[] })
      })

export const makeObjectProxiedFunctions = (value: any) =>
  isTransferable(value) ? value :
  value && typeof value === 'object' && value[PROXY_FUNCTION_PROPERTY] ? makeProxiedFunction(value[PROXY_FUNCTION_PROPERTY]) :
  Array.isArray(value) ? value.map(proxyObjectFunctions) :
  value && typeof value === 'object' ? (
    Object.fromEntries(
      Object
        .entries(value)
        .map(([key, value]) => [
          key,
          makeObjectProxiedFunctions(value)
        ])
    )
  ) :
  value

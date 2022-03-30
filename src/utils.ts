import { TransferableObject } from './types'

const isTransferable = (value: any) =>
  value instanceof ArrayBuffer ? true :
  value instanceof MessagePort ? true :
  value instanceof ReadableStream ? true :
  value instanceof WritableStream ? true :
  value instanceof TransformStream ? true :
  value instanceof ImageBitmap ? true :
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
  port1.addEventListener('message', (ev) => {
    const res = func(...ev.data)
    const transferables = getTransferableObjects(res)
    port1.postMessage(proxyObjectFunctions(res), { transfer: transferables as unknown as Transferable[] })
    console.log('makeProxyFunction funcCall', ev.data, res, func)
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

export const makeProxiedFunction = (port: MessagePort) => {
  return (...args) => {
    return new Promise((resolve, reject) => {
      console.log('makeProxiedFunction funcCall', args)
      const proxiedArguments = proxyObjectFunctions(args)
      const transferables = getTransferableObjects(proxiedArguments)
      port.addEventListener('message', (ev) => {
        console.log('makeProxiedFunction message response', args, makeObjectProxiedFunctions(ev.data))
        resolve(makeObjectProxiedFunctions(ev.data))
      })
      port.start()
      port.postMessage(proxiedArguments, { transfer: transferables as unknown as Transferable[] })
    })
  }
}

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

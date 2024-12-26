import type {
  StructuredCloneTransferableType, TransferableObject, ProxiedErrorType,
  ProxiedFunctionType, ProxiedMessagePortType, ProxiedPromiseType,
  ProxiedType, StructuredCloneTransferableProxiableType,
} from './types'

import { OSRA_PROXY } from './types'

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

export type EnvCheck = {
  uuid: string
  supportsPorts: boolean
  jsonOnly: boolean
}

export type Context = {
  envCheck: EnvCheck
  addIncomingProxiedMessagePort: (portId: string) => MessagePort
  addOutgoingProxiedMessagePort: (port: MessagePort) => string
  finalizationRegistry: FinalizationRegistry<number>
}

export const proxiedFunctionToFunction = <JsonOnly extends boolean>(proxiedFunction: ProxiedFunctionType<JsonOnly>, context: Context) => {
  const portId = 'portId' in proxiedFunction ? proxiedFunction.portId : undefined
  const port =
    'port' in proxiedFunction ? proxiedFunction.port
    : portId ? context.addIncomingProxiedMessagePort(portId)
    : undefined
  if (!port) throw new Error(`No ports received for proxied function`)

  const func = (...args: StructuredCloneTransferableType[]) =>
    new Promise((resolve, reject) => {
      const { port1: returnValueLocalPort, port2: returnValueRemotePort } = new MessageChannel()
      const functionContext = replaceOutgoingProxiedTypes([returnValueRemotePort, args], context)
      const functionContextTransferables = getTransferableObjects(functionContext)
      const listener = (event: MessageEvent) => {
        const result = replaceIncomingProxiedTypes(event.data, context)
        if (!(result instanceof Promise)) throw new Error(`Proxied function did not return a promise`)

        result
          .then(resolve)
          .catch(reject)
          .finally(() => returnValueLocalPort.close())
      }
      returnValueLocalPort.addEventListener('message', listener, { once: true })
      returnValueLocalPort.start()
      port.postMessage(functionContext, { transfer: functionContextTransferables })
    })

  if (portId) {
    context.finalizationRegistry.register(func, Number(portId.split('/')[1]))
  }

  return func
}

export const proxiedMessagePortToMessagePort = <JsonOnly extends boolean>(proxiedMessagePort: ProxiedMessagePortType<JsonOnly>, context: Context) => {
  const port =
    context.envCheck.supportsPorts && 'port' in proxiedMessagePort ? proxiedMessagePort.port
    : 'portId' in proxiedMessagePort ? context.addIncomingProxiedMessagePort(proxiedMessagePort.portId)
    : undefined
  if (!port) throw new Error(`No ports received for proxied message port`)
  return port
}

export const proxiedErrorToError = (proxiedError: ProxiedErrorType, context: Context) =>
  new Error(proxiedError.message, { cause: proxiedError.stack })

export const proxiedPromiseToPromise = <JsonOnly extends boolean>(proxiedPromise: ProxiedPromiseType<JsonOnly>, context: Context) =>
  new Promise((resolve, reject) => {
    const port =
      'port' in proxiedPromise ? proxiedPromise.port
      : 'portId' in proxiedPromise ? context.addIncomingProxiedMessagePort(proxiedPromise.portId)
      : undefined
    if (!port) throw new Error(`No ports received for proxied promise`)
    const listener = async (event: MessageEvent) => {
      const result = await replaceIncomingProxiedTypes(event.data, context)
      if (result instanceof Error) reject(result)
      else resolve(result)
      port.close()
    }
    port.addEventListener('message', listener, { once: true })
    port.start()
  })

export const replaceIncomingProxiedTypes = (value: StructuredCloneTransferableType, context: Context): StructuredCloneTransferableProxiableType =>
  replaceRecursive(
    value,
    (value) => Boolean(
      value && typeof value === 'object' && OSRA_PROXY in value && value[OSRA_PROXY]
    ),
    (proxiedValue: ProxiedType<boolean>) => {
      if (proxiedValue.type === 'function') {
        return proxiedFunctionToFunction(proxiedValue, context)
      } else if (proxiedValue.type === 'error') {
        return proxiedErrorToError(proxiedValue, context)
      } else if (proxiedValue.type === 'messagePort') {
        return proxiedMessagePortToMessagePort(proxiedValue, context)
      } else if (proxiedValue.type === 'promise') {
        return proxiedPromiseToPromise(proxiedValue, context)
      }
      throw new Error(`Unknown incoming proxied type: ${value}`)
    })

export const errorToProxiedError = (error: Error, _: Context) => ({
  [OSRA_PROXY]: true,
  type: 'error',
  message: error.message,
  stack: error.stack
})

export const messagePortToProxiedMessagePort = (port: MessagePort, context: Context) => ({
  [OSRA_PROXY]: true,
  type: 'messagePort',
  ...context.envCheck.supportsPorts
    ? { port }
    : { portId: context.addOutgoingProxiedMessagePort(port) }
})

export const promiseToProxiedPromise = (promise: Promise<StructuredCloneTransferableType>, context: Context) => {
  const { port1: localPort, port2: remotePort } = new MessageChannel()

  const sendResult = (resultOrError: StructuredCloneTransferableType) => {
    const proxiedResult = replaceOutgoingProxiedTypes(resultOrError, context)
    const transferables = getTransferableObjects(proxiedResult)
    localPort.postMessage(proxiedResult, { transfer: transferables })
    localPort.close()
  }

  promise
    .then(sendResult)
    .catch(sendResult)

  return {
    [OSRA_PROXY]: true,
    type: 'promise',
    port: replaceOutgoingProxiedTypes(remotePort, context)
  }
}

export const functionToProxiedFunction = (func: Function, context: Context) => {
  const { port1: localPort, port2: remotePort } = new MessageChannel()
  localPort.addEventListener('message', async (ev: MessageEvent<[ProxiedType<boolean>, StructuredCloneTransferableType[]]>) => {
    const [returnValuePort, args] = replaceIncomingProxiedTypes(ev.data, context) as [MessagePort, StructuredCloneTransferableType[]]
    const result = (async () => func(...args))()
    const proxiedResult = replaceOutgoingProxiedTypes(result, context)
    const transferables = getTransferableObjects(proxiedResult)
    returnValuePort.postMessage(proxiedResult, { transfer: transferables })
    returnValuePort.close()
  })
  localPort.start()
  return {
    [OSRA_PROXY]: true,
    type: 'function',
    port: replaceOutgoingProxiedTypes(remotePort, context)
  }
}

export const replaceOutgoingProxiedTypes = <T extends StructuredCloneTransferableProxiableType>(value: T, context: Context) =>
  replaceRecursive(
    value,
    (value) => typeof value === 'function' || value instanceof Error || value instanceof MessagePort || value instanceof Promise,
    (value) => {
      if (typeof value === 'function') {
        return functionToProxiedFunction(value, context)
      } else if (value instanceof Error) {
        return errorToProxiedError(value, context)
      } else if (value instanceof MessagePort) {
        return messagePortToProxiedMessagePort(value, context)
      } else if (value instanceof Promise) {
        return promiseToProxiedPromise(value, context)
      }
      throw new Error(`Unknown outgoing proxied type: ${value}`)
    }
  )

export const replaceRecursive = <
  T extends StructuredCloneTransferableProxiableType,
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

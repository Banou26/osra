import type {
  CustomTransport, EmitJsonPlatformTransport,
  EmitPlatformTransport, JsonPlatformTransport,
  Message, ReceiveJsonPlatformTransport,
  ReceivePlatformTransport, Transport
} from '../types'

import { OSRA_KEY } from '../types'
import { getWebExtensionRuntime } from './platform'

export const isWebSocket = (value: any) => value instanceof WebSocket
export const isServiceWorkerContainer = (value: any) => value instanceof ServiceWorkerContainer
export const isWorker = (value: any) => value instanceof Worker
export const isSharedWorker = (value: any) => value instanceof SharedWorker
export const isMessagePort = (value: any) => value instanceof MessagePort

export const isOsraMessage = (value: any): value is Message =>
  Boolean(
    value
    && typeof value === 'object'
    && (value as Message)[OSRA_KEY]
  )

export const isClonable = (value: any) =>
    globalThis.SharedArrayBuffer && value instanceof globalThis.SharedArrayBuffer ? true
  : false

export const isTransferable = (value: any): value is Transferable =>
    globalThis.ArrayBuffer && value instanceof globalThis.ArrayBuffer ? true
  : globalThis.MessagePort && value instanceof globalThis.MessagePort ? true
  : globalThis.ReadableStream && value instanceof globalThis.ReadableStream ? true
  : globalThis.WritableStream && value instanceof globalThis.WritableStream ? true
  : globalThis.TransformStream && value instanceof globalThis.TransformStream ? true
  : globalThis.ImageBitmap && value instanceof globalThis.ImageBitmap ? true
  : false

export const getTransferableObjects = (value: any): Transferable[] => {
  const transferables: Transferable[] = []
  const recurse = (value: any): any =>
    isClonable(value) ? undefined
    : isTransferable(value) ? transferables.push(value)
    : Array.isArray(value) ? value.map(recurse)
    : value && typeof value === 'object' ? Object.values(value).map(recurse)
    : undefined

  recurse(value)
  return transferables
}

export type WebExtRuntime = typeof browser.runtime
export const isWebExtensionRuntime = (value: any): value is WebExtRuntime => {
  const runtime = getWebExtensionRuntime()
  return Boolean(
    value
    && typeof value === 'object'
    && isWebExtensionOnConnect(runtime.onConnect)
    && runtime.id
  )
}

export type WebExtPort = ReturnType<WebExtRuntime['connect']>
export const isWebExtensionPort = (value: any, connectPort: boolean = false): value is WebExtPort => {
  return Boolean(
    value
    && typeof value === 'object'
    && (value as WebExtPort).name
    && (value as WebExtPort).disconnect
    && (value as WebExtPort).postMessage
    && (
      connectPort
        // these properties are only present on WebExtPort that were created through runtime.connect()
        ? (
             (value as WebExtPort).sender
          && (value as WebExtPort).onMessage
          && (value as WebExtPort).onDisconnect
        )
        : true
    )
  )
}

export type WebExtOnConnect = WebExtRuntime['onConnect']
export const isWebExtensionOnConnect = (value: any): value is WebExtOnConnect =>
  Boolean(
    value
    && typeof value === 'object'
    && (value as WebExtOnConnect).addListener
    && (value as WebExtOnConnect).hasListener
    && (value as WebExtOnConnect).removeListener
  )

export type WebExtOnMessage = WebExtRuntime['onMessage']
export const isWebExtensionOnMessage = (value: any): value is WebExtOnMessage =>
  Boolean(
    value
    && typeof value === 'object'
    && (value as WebExtOnMessage).addListener
    && (value as WebExtOnMessage).hasListener
    && (value as WebExtOnMessage).removeListener
  )

export const isWindow = (value: any): value is Window => {
  return Boolean(
    value
    && typeof value === 'object'
    && (value as Window).document
    && (value as Window).location
    && (value as Window).navigator
    && (value as Window).screen
    && (value as Window).history
  )
}

export type IsTransportEmitJsonOnly<T extends Transport> = T extends EmitJsonPlatformTransport ? true : false
export const isTransportEmitJsonOnly = (value: any): value is EmitJsonPlatformTransport =>
     isWebSocket(value)
  || isWebExtensionPort(value)

export type IsTransportReceiveJsonOnly<T extends Transport> = T extends ReceiveJsonPlatformTransport ? true : false
export const isTransportReceiveJsonOnly = (value: any): value is ReceiveJsonPlatformTransport =>
     isWebSocket(value)
  || isWebExtensionPort(value)
  || isWebExtensionOnConnect(value)
  || isWebExtensionOnMessage(value)

export type IsTransportJsonOnly<T extends Transport> = T extends JsonPlatformTransport ? true : false
export const isTransportJsonOnly = (value: any): value is JsonPlatformTransport =>
     isTransportEmitJsonOnly(value)
  || isTransportReceiveJsonOnly(value)

export type IsTransportEmitOnly<T extends Transport> = T extends EmitPlatformTransport ? true : false
export const isTransportEmitOnly = (value: any): value is EmitPlatformTransport =>
    isTransportEmitJsonOnly(value)
  || isWindow(value)
  || isServiceWorkerContainer(value)
  || isWorker(value)
  || isSharedWorker(value)
  || isMessagePort(value)

export type IsTransportReceiveOnly<T extends Transport> = T extends ReceivePlatformTransport ? true : false
export const isTransportReceiveOnly = (value: any): value is ReceivePlatformTransport =>
    isTransportReceiveJsonOnly(value)
  || isWindow(value)
  || isServiceWorkerContainer(value)
  || isWorker(value)
  || isSharedWorker(value)
  || isMessagePort(value)

export type IsTransportCustom<T extends Transport> = T extends CustomTransport ? true : false
export const isTransportCustom = (value: any): value is CustomTransport =>
  Boolean(
    value
    && typeof value === 'object'
    && (value as CustomTransport).emit
    && (
      isTransportEmitOnly((value as CustomTransport).emit)
      || typeof (value as CustomTransport).emit === 'function'
    )
    && (value as CustomTransport).receive
    && (
      isTransportReceiveOnly((value as CustomTransport).receive)
      || typeof (value as CustomTransport).receive === 'function'
    )
  )

export const isTransport = (value: any): value is Transport =>
     isTransportJsonOnly(value)
  || isTransportEmitOnly(value)
  || isTransportReceiveOnly(value)
  || isTransportCustom(value)

import type {
  CustomEmitTransport, CustomReceiveTransport,
  CustomTransport, EmitJsonPlatformTransport,
  EmitTransport, JsonPlatformTransport,
  Message, ReceiveJsonPlatformTransport,
  ReceiveTransport, Revivable, RevivableBox, RevivableToRevivableType, RevivableVariantType, TransferBox, Transport
} from '../types'

import { OSRA_BOX, OSRA_KEY } from '../types'
import { getWebExtensionRuntime } from './platform'

export const isWebSocket = (value: any) => value instanceof WebSocket
export const isServiceWorkerContainer = (value: any) => value instanceof ServiceWorkerContainer
export const isWorker = (value: any) => value instanceof Worker
export const isSharedWorker = (value: any) => value instanceof SharedWorker
export const isMessagePort = (value: any) => value instanceof MessagePort
export const isPromise = (value: any) => value instanceof Promise
export const isFunction = (value: any): value is Function => typeof value === 'function'
export const isArrayBuffer = (value: any) => value instanceof ArrayBuffer
export const isReadableStream = (value: any) => value instanceof ReadableStream
export const isDate = (value: any) => value instanceof Date
export const isError = (value: any) => value instanceof Error

export const isAlwaysBox = (value: any): value is Function | Promise<any> | Date | Error =>
  isFunction(value)
  || isPromise(value)
  || isDate(value)
  || isError(value)

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

export const isTransferBox = (value: any): value is TransferBox<any> =>
  Boolean(
    value
    && typeof value === 'object'
    && (value as TransferBox<Transferable>)[OSRA_BOX] === 'transferable'
  )

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

export type WebExtSender = NonNullable<WebExtPort['sender']>

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

export type IsEmitJsonOnlyTransport<T extends Transport> = T extends EmitJsonPlatformTransport ? true : false
export const isEmitJsonOnlyTransport = (value: any): value is EmitJsonPlatformTransport =>
     isWebSocket(value)
  || isWebExtensionPort(value)

export type IsReceiveJsonOnlyTransport<T extends Transport> = T extends ReceiveJsonPlatformTransport ? true : false
export const isReceiveJsonOnlyTransport = (value: any): value is ReceiveJsonPlatformTransport =>
     isWebSocket(value)
  || isWebExtensionPort(value)
  || isWebExtensionOnConnect(value)
  || isWebExtensionOnMessage(value)

export type IsJsonOnlyTransport<T extends Transport> = T extends JsonPlatformTransport ? true : false
export const isJsonOnlyTransport = (value: any): value is JsonPlatformTransport =>
     isEmitJsonOnlyTransport(value)
  || isReceiveJsonOnlyTransport(value)

export type IsEmitTransport<T extends Transport> = T extends EmitTransport ? true : false
export const isEmitTransport = (value: any): value is EmitTransport =>
    isEmitJsonOnlyTransport(value)
  || isWindow(value)
  || isServiceWorkerContainer(value)
  || isWorker(value)
  || isSharedWorker(value)
  || isMessagePort(value)
  || isCustomEmitTransport(value)

export function assertEmitTransport (transport: Transport): asserts transport is EmitTransport {
  if (!isEmitTransport(transport)) throw new Error('Transport is not emitable')
}


export type IsReceiveTransport<T extends Transport> = T extends ReceiveTransport ? true : false
export const isReceiveTransport = (value: any): value is ReceiveTransport =>
    isReceiveJsonOnlyTransport(value)
  || isWindow(value)
  || isServiceWorkerContainer(value)
  || isWorker(value)
  || isSharedWorker(value)
  || isMessagePort(value)
  || isCustomReceiveTransport(value)

export function assertReceiveTransport (transport: Transport): asserts transport is ReceiveTransport {
  if (!isReceiveTransport(transport)) throw new Error('Transport is not receiveable')
}

export const isCustomEmitTransport = (value: any): value is CustomEmitTransport =>
  Boolean(
    value
    && typeof value === 'object'
    && (
      'emit' in value
      && (
        isEmitTransport(value.emit)
        || typeof value.emit === 'function'
      )
    )
  )

export const isCustomReceiveTransport = (value: any): value is CustomReceiveTransport =>
  Boolean(
    value
    && typeof value === 'object'
    && (
      'receive' in value
      && (
        isReceiveTransport(value.receive)
        || typeof value.receive === 'function'
      )
    )
  )

export type IsCustomTransport<T extends Transport> = T extends CustomTransport ? true : false
export const isCustomTransport = (value: any): value is CustomTransport =>
    isCustomEmitTransport(value)
  || isCustomReceiveTransport(value)

export const isTransport = (value: any): value is Transport =>
     isJsonOnlyTransport(value)
  || isEmitTransport(value)
  || isReceiveTransport(value)
  || isCustomTransport(value)

export const isRevivable = (value: any): value is Revivable =>
  isMessagePort(value)
  || isFunction(value)
  || isPromise(value)
  || isReadableStream(value)
  || isDate(value)
  || isError(value)

export const isRevivableBox = (value: any): value is RevivableBox =>
  value
  && typeof value === 'object'
  && OSRA_BOX in value
  && value[OSRA_BOX] === 'revivable'

export const isRevivableMessagePortBox = (value: any): value is RevivableBox & { type: 'messagePort' } =>
  isRevivableBox(value) && value.type === 'messagePort'

export const isRevivablePromiseBox = (value: any): value is RevivableBox & { type: 'promise' } =>
  isRevivableBox(value) && value.type === 'promise'

export const isRevivableFunctionBox = (value: any): value is RevivableBox & { type: 'function' } =>
  isRevivableBox(value) && value.type === 'function'

export const isRevivableReadableStreamBox = (value: any): value is RevivableBox & { type: 'readableStream' } =>
  isRevivableBox(value) && value.type === 'readableStream'

export const isRevivableErrorBox = (value: any): value is RevivableBox & { type: 'error' } =>
  isRevivableBox(value) && value.type === 'error'

export const isRevivableDateBox = (value: any): value is RevivableBox & { type: 'date' } =>
  isRevivableBox(value) && value.type === 'date'

export const revivableBoxToType = (value: RevivableBox) => value.type

export const revivableToType = <T extends Revivable>(value: T): RevivableToRevivableType<T> => {
  if (isMessagePort(value)) return 'messagePort' as RevivableToRevivableType<T>
  if (isFunction(value)) return 'function' as RevivableToRevivableType<T>
  if (isPromise(value)) return 'promise' as RevivableToRevivableType<T>
  if (isReadableStream(value)) return 'readableStream' as RevivableToRevivableType<T>
  if (isDate(value)) return 'date' as RevivableToRevivableType<T>
  if (isError(value)) return 'error' as RevivableToRevivableType<T>
  throw new Error('Unknown revivable type')
}

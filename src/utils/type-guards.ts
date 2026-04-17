import type { Runtime } from 'webextension-polyfill'
import type {
  CustomEmitTransport, CustomReceiveTransport,
  CustomTransport, EmitJsonPlatformTransport,
  EmitTransport, JsonPlatformTransport,
  Message, ReceiveJsonPlatformTransport,
  ReceiveTransport, Transport
} from '../types'

import { OSRA_KEY } from '../types'
import { getWebExtensionRuntime } from './platform'

const typedArrayConstructors = {
  Int8Array,
  Uint8Array,
  Uint8ClampedArray,
  Int16Array,
  Uint16Array,
  Int32Array,
  Uint32Array,
  Float16Array,
  Float32Array,
  Float64Array,
  BigInt64Array,
  BigUint64Array
} as const
export type TypeArrayType = keyof typeof typedArrayConstructors
export type TypedArrayConstructor = typeof typedArrayConstructors[TypeArrayType]
export type TypedArray = InstanceType<TypedArrayConstructor>

const typedArrayEntries = Object.entries(typedArrayConstructors) as readonly [TypeArrayType, TypedArrayConstructor][]

export const typedArrayToType = <T extends TypedArray>(value: T): TypeArrayType => {
  const entry = typedArrayEntries.find(([, ctor]) => value instanceof ctor)
  if (!entry) throw new Error('Unknown typed array type')
  return entry[0]
}

export const typedArrayTypeToTypedArrayConstructor = (value: TypeArrayType): TypedArrayConstructor =>
  typedArrayConstructors[value]

export const isTypedArray = (value: unknown): value is TypedArray =>
  typedArrayEntries.some(([, ctor]) => value instanceof ctor)
export const isWebSocket = (value: unknown): value is WebSocket =>
  typeof WebSocket !== 'undefined' && value instanceof WebSocket
export const isServiceWorkerContainer = (value: unknown): value is ServiceWorkerContainer =>
  typeof ServiceWorkerContainer !== 'undefined' && value instanceof ServiceWorkerContainer
export const isWorker = (value: unknown): value is Worker =>
  typeof Worker !== 'undefined' && value instanceof Worker
export const isDedicatedWorker = (value: unknown): value is DedicatedWorkerGlobalScope =>
  // @ts-expect-error DedicatedWorkerGlobalScope is not defined in all TS lib configurations
  typeof DedicatedWorkerGlobalScope !== 'undefined' && value instanceof DedicatedWorkerGlobalScope
export const isSharedWorker = (value: unknown): value is SharedWorker =>
  typeof SharedWorker !== 'undefined' && value instanceof SharedWorker
export const isMessagePort = (value: unknown): value is MessagePort =>
  typeof MessagePort !== 'undefined' && value instanceof MessagePort
export const isPromise = (value: unknown): value is Promise<unknown> =>
  value instanceof Promise
export const isFunction = (value: unknown): value is Function =>
  typeof value === 'function'
export const isArrayBuffer = (value: unknown): value is ArrayBuffer =>
  typeof ArrayBuffer !== 'undefined' && value instanceof ArrayBuffer
export const isReadableStream = (value: unknown): value is ReadableStream =>
  typeof ReadableStream !== 'undefined' && value instanceof ReadableStream
export const isDate = (value: unknown): value is Date => value instanceof Date
export const isError = (value: unknown): value is Error => value instanceof Error

export const isAlwaysBox = (value: unknown): value is Function | Promise<unknown> | TypedArray | Date | Error =>
  isFunction(value)
  || isPromise(value)
  || isTypedArray(value)
  || isDate(value)
  || isError(value)

export const isOsraMessage = (value: unknown): value is Message =>
  Boolean(
    value
    && typeof value === 'object'
    && (value as Message)[OSRA_KEY]
  )

export const isClonable = (value: unknown): value is SharedArrayBuffer =>
  typeof SharedArrayBuffer !== 'undefined' && value instanceof SharedArrayBuffer

export const isTransferable = (value: unknown): value is Transferable =>
     isArrayBuffer(value)
  || isMessagePort(value)
  || isReadableStream(value)
  || (typeof WritableStream !== 'undefined' && value instanceof WritableStream)
  || (typeof TransformStream !== 'undefined' && value instanceof TransformStream)
  || (typeof ImageBitmap !== 'undefined' && value instanceof ImageBitmap)

export type WebExtRuntime = typeof browser.runtime
export const isWebExtensionRuntime = (value: any): value is WebExtRuntime => {
  const runtime = getWebExtensionRuntime()
  if (!runtime) return false
  return value === runtime
}

export type WebExtPort = ReturnType<WebExtRuntime['connect']> | Runtime.Port
export const isWebExtensionPort = (value: any, connectPort: boolean = false): value is WebExtPort => {
  return Boolean(
    value
    && typeof value === 'object'
    /**
     * This is needed to prevent throwing an error when the value is a cross origin iframe window object.
     * e.g SecurityError: Blocked a frame with origin "http://localhost:8080" from accessing a cross-origin frame.
     */
    && !isWindow(value)
    && ('name' in (value as WebExtPort))
    && ('disconnect' in (value as WebExtPort))
    && ('postMessage' in (value as WebExtPort))
    && (
      connectPort
        // these properties are only present on WebExtPort that were created through runtime.connect()
        ? (
             ('sender' in (value as WebExtPort))
             && ('onMessage' in (value as WebExtPort))
             && ('onDisconnect' in (value as WebExtPort))
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
    /**
     * This is needed to prevent throwing an error when the value is a cross origin iframe window object.
     * e.g SecurityError: Blocked a frame with origin "http://localhost:8080" from accessing a cross-origin frame.
     */
    && !isWindow(value)
    && (value as WebExtOnConnect).addListener
    && (value as WebExtOnConnect).hasListener
    && (value as WebExtOnConnect).removeListener
  )

export type WebExtOnMessage = WebExtRuntime['onMessage']
export const isWebExtensionOnMessage = (value: any): value is WebExtOnMessage =>
  Boolean(
    value
    && typeof value === 'object'
    /**
     * This is needed to prevent throwing an error when the value is a cross origin iframe window object.
     * e.g SecurityError: Blocked a frame with origin "http://localhost:8080" from accessing a cross-origin frame.
     */
    && !isWindow(value)
    && (value as WebExtOnMessage).addListener
    && (value as WebExtOnMessage).hasListener
    && (value as WebExtOnMessage).removeListener
  )

export const isWindow = (value: unknown): value is Window => {
    if (!value || typeof value !== 'object') return false

    try {
      return (value as Window).window === value
    } catch {
      try {
        const w = value as Window
        return typeof w.closed === 'boolean' && typeof w.close === 'function'
      } catch {
        return false
      }
    }
  }

export type IsEmitJsonOnlyTransport<T extends Transport> = T extends EmitJsonPlatformTransport ? true : false
export const isEmitJsonOnlyTransport = (value: any): value is EmitJsonPlatformTransport =>
     isWebSocket(value)
  || isWebExtensionPort(value)
  || isWebExtensionRuntime(value)

export type IsReceiveJsonOnlyTransport<T extends Transport> = T extends ReceiveJsonPlatformTransport ? true : false
export const isReceiveJsonOnlyTransport = (value: any): value is ReceiveJsonPlatformTransport =>
     isWebSocket(value)
  || isWebExtensionPort(value)
  || isWebExtensionOnConnect(value)
  || isWebExtensionOnMessage(value)
  || isWebExtensionRuntime(value)

export type IsJsonOnlyTransport<T extends Transport> = T extends JsonPlatformTransport ? true : false
export const isJsonOnlyTransport = (value: Transport): value is Extract<Transport, JsonPlatformTransport> =>
    ('isJson' in value && value.isJson === true)
  || isEmitJsonOnlyTransport(value)
  || isReceiveJsonOnlyTransport(value)

export type IsEmitTransport<T extends Transport> = T extends EmitTransport ? true : false
export const isEmitTransport = (value: any): value is EmitTransport =>
     isWindow(value)
  || isEmitJsonOnlyTransport(value)
  || isServiceWorkerContainer(value)
  || isWorker(value)
  || isDedicatedWorker(value)
  || isSharedWorker(value)
  || isMessagePort(value)
  || isCustomEmitTransport(value)

export function assertEmitTransport (transport: Transport): asserts transport is EmitTransport {
  if (!isEmitTransport(transport)) throw new Error('Transport is not emitable')
}


export type IsReceiveTransport<T extends Transport> = T extends ReceiveTransport ? true : false
export const isReceiveTransport = (value: any): value is ReceiveTransport =>
     isWindow(value)
  || isReceiveJsonOnlyTransport(value)
  || isServiceWorkerContainer(value)
  || isWorker(value)
  || isDedicatedWorker(value)
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
    /**
     * This is needed to prevent throwing an error when the value is a cross origin iframe window object.
     * e.g SecurityError: Blocked a frame with origin "http://localhost:8080" from accessing a cross-origin frame.
     */
    && !isWindow(value)
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
    /**
     * This is needed to prevent throwing an error when the value is a cross origin iframe window object.
     * e.g SecurityError: Blocked a frame with origin "http://localhost:8080" from accessing a cross-origin frame.
     */
    && !isWindow(value)
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
     isEmitTransport(value)
  || isReceiveTransport(value)
  || isCustomTransport(value)
  || isJsonOnlyTransport(value)

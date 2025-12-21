import type { Runtime } from 'webextension-polyfill'
import type {
  CustomEmitTransport, CustomReceiveTransport,
  CustomTransport, EmitJsonPlatformTransport,
  EmitTransport, JsonPlatformTransport,
  Message, ReceiveJsonPlatformTransport,
  ReceiveTransport, TransferBox, Transport
} from '../types'

import { OSRA_BOX, OSRA_KEY } from '../types'
import { getWebExtensionRuntime } from './platform'

// Re-export isRevivable and isRevivableBox from revivables module
// These are now dynamically determined based on the registered modules
export { isRevivable, isRevivableBox } from './revivables'

// Re-export types
export type {
  Revivable,
  RevivableBox,
  RevivableVariant,
  RevivableVariantType,
  SourceToRevivableType
} from './revivables'

import type {
  Revivable,
  RevivableBox,
  RevivableVariantType,
  SourceToRevivableType
} from './revivables'

// ============================================================================
// TypedArray Utilities
// ============================================================================

const typedArrayConstructors = [
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
]
export type TypedArrayConstructor = typeof typedArrayConstructors[number]

const typedArrays = [
  new Int8Array(),
  new Uint8Array(),
  new Uint8ClampedArray(),
  new Int16Array(),
  new Uint16Array(),
  new Int32Array(),
  new Uint32Array(),
  new Float16Array(),
  new Float32Array(),
  new Float64Array(),
  new BigInt64Array(),
  new BigUint64Array()
]
export type TypedArray = typeof typedArrays[number]
export const typedArrayToType = <T extends TypedArray>(value: T) => {
  const type =
    value instanceof Int8Array ? 'Int8Array' :
    value instanceof Uint8Array ? 'Uint8Array' :
    value instanceof Uint8ClampedArray ? 'Uint8ClampedArray' :
    value instanceof Int16Array ? 'Int16Array' :
    value instanceof Uint16Array ? 'Uint16Array' :
    value instanceof Int32Array ? 'Int32Array' :
    value instanceof Uint32Array ? 'Uint32Array' :
    value instanceof Float16Array ? 'Float16Array' :
    value instanceof Float32Array ? 'Float32Array' :
    value instanceof Float64Array ? 'Float64Array' :
    value instanceof BigInt64Array ? 'BigInt64Array' :
    value instanceof BigUint64Array ? 'BigUint64Array' :
    undefined
  if (type === undefined) throw new Error('Unknown typed array type')
  return type
}
export type TypeArrayType = ReturnType<typeof typedArrayToType>
export const typedArrayTypeToTypedArrayConstructor = (value: TypeArrayType): TypedArrayConstructor => {
  const typedArray =
    value === 'Int8Array' ? Int8Array :
    value === 'Uint8Array' ? Uint8Array :
    value === 'Uint8ClampedArray' ? Uint8ClampedArray :
    value === 'Int16Array' ? Int16Array :
    value === 'Uint16Array' ? Uint16Array :
    value === 'Int32Array' ? Int32Array :
    value === 'Uint32Array' ? Uint32Array :
    value === 'Float16Array' ? Float16Array :
    value === 'Float32Array' ? Float32Array :
    value === 'Float64Array' ? Float64Array :
    value === 'BigInt64Array' ? BigInt64Array :
    value === 'BigUint64Array' ? BigUint64Array :
    undefined
  if (typedArray === undefined) throw new Error('Unknown typed array type')
  return typedArray
}

// ============================================================================
// Basic Type Guards
// ============================================================================

export const isTypedArray = (value: any): value is TypedArray => typedArrayConstructors.some(typedArray => value instanceof typedArray)
export const isWebSocket = (value: any) => value instanceof WebSocket
export const isServiceWorkerContainer = (value: any): value is ServiceWorkerContainer => globalThis.ServiceWorkerContainer && value instanceof ServiceWorkerContainer
export const isWorker = (value: any): value is Worker => globalThis.Worker && value instanceof Worker
// @ts-expect-error
export const isDedicatedWorker = (value: any): value is DedicatedWorkerGlobalScope => globalThis.DedicatedWorkerGlobalScope && value instanceof DedicatedWorkerGlobalScope
export const isSharedWorker = (value: any): value is SharedWorker => globalThis.SharedWorker && value instanceof SharedWorker
export const isMessagePort = (value: any) => value instanceof MessagePort
export const isPromise = (value: any) => value instanceof Promise
export const isFunction = (value: any): value is Function => typeof value === 'function'
export const isArrayBuffer = (value: any) => value instanceof ArrayBuffer
export const isReadableStream = (value: any) => value instanceof ReadableStream
export const isDate = (value: any) => value instanceof Date
export const isError = (value: any) => value instanceof Error

// ============================================================================
// Osra Message Type Guards
// ============================================================================

export const isOsraMessage = (value: any): value is Message =>
  Boolean(
    value
    && typeof value === 'object'
    && (value as Message)[OSRA_KEY]
  )

// ============================================================================
// Clonable and Transferable Type Guards
// ============================================================================

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

// ============================================================================
// WebExtension Type Guards
// ============================================================================

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

export type WebExtPort = ReturnType<WebExtRuntime['connect']> | Runtime.Port
export const isWebExtensionPort = (value: any, connectPort: boolean = false): value is WebExtPort => {
  return Boolean(
    value
    && typeof value === 'object'
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

// ============================================================================
// Transport Type Guards
// ============================================================================

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
  || isDedicatedWorker(value)
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

// ============================================================================
// Revivable Box Type Guards
// ============================================================================

// Import isRevivableBox from revivables for use in the type guards below
import { isRevivableBox } from './revivables'

export const isRevivableMessagePortBox = (value: any): value is RevivableBox & { type: 'messagePort' } =>
  isRevivableBox(value) && value.type === 'messagePort'

export const isRevivablePromiseBox = (value: any): value is RevivableBox & { type: 'promise' } =>
  isRevivableBox(value) && value.type === 'promise'

export const isRevivableFunctionBox = (value: any): value is RevivableBox & { type: 'function' } =>
  isRevivableBox(value) && value.type === 'function'

export const isRevivableTypedArrayBox = (value: any): value is RevivableBox & { type: 'typedArray' } =>
  isRevivableBox(value) && value.type === 'typedArray'

export const isRevivableArrayBufferBox = (value: any): value is RevivableBox & { type: 'arrayBuffer' } =>
  isRevivableBox(value) && value.type === 'arrayBuffer'

export const isRevivableReadableStreamBox = (value: any): value is RevivableBox & { type: 'readableStream' } =>
  isRevivableBox(value) && value.type === 'readableStream'

export const isRevivableErrorBox = (value: any): value is RevivableBox & { type: 'error' } =>
  isRevivableBox(value) && value.type === 'error'

export const isRevivableDateBox = (value: any): value is RevivableBox & { type: 'date' } =>
  isRevivableBox(value) && value.type === 'date'

export const revivableBoxToType = (value: RevivableBox) => value.type

export const revivableToType = <T extends Revivable>(value: T): SourceToRevivableType<T> => {
  if (isMessagePort(value)) return 'messagePort' as SourceToRevivableType<T>
  if (isFunction(value)) return 'function' as SourceToRevivableType<T>
  if (isPromise(value)) return 'promise' as SourceToRevivableType<T>
  if (isTypedArray(value)) return 'typedArray' as SourceToRevivableType<T>
  if (isArrayBuffer(value)) return 'arrayBuffer' as SourceToRevivableType<T>
  if (isReadableStream(value)) return 'readableStream' as SourceToRevivableType<T>
  if (isDate(value)) return 'date' as SourceToRevivableType<T>
  if (isError(value)) return 'error' as SourceToRevivableType<T>
  throw new Error('Unknown revivable type')
}

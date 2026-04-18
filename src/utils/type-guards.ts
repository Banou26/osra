import type { Runtime } from 'webextension-polyfill'
import type { Message } from '../types'
import type {
  CustomEmitTransport, CustomReceiveTransport,
  CustomTransport, EmitJsonPlatformTransport,
  EmitTransport, JsonPlatformTransport,
  ReceiveJsonPlatformTransport,
  ReceiveTransport, Transport
} from './transport'

import { OSRA_KEY } from '../types'
import { getWebExtensionRuntime } from './transport'

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
export type TypedArrayType = ReturnType<typeof typedArrayToType>
export const typedArrayTypeToTypedArrayConstructor = (value: TypedArrayType): TypedArrayConstructor => {
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

export const isTypedArray = (value: unknown): value is TypedArray => typedArrayConstructors.some(typedArray => value instanceof typedArray)
export const isWebSocket = (value: unknown): value is WebSocket => value instanceof WebSocket
export const isServiceWorkerContainer = (value: unknown): value is ServiceWorkerContainer => !!globalThis.ServiceWorkerContainer && value instanceof ServiceWorkerContainer
export const isWorker = (value: unknown): value is Worker => !!globalThis.Worker && value instanceof Worker
// @ts-expect-error
export const isDedicatedWorker = (value: unknown): value is DedicatedWorkerGlobalScope => !!globalThis.DedicatedWorkerGlobalScope && value instanceof DedicatedWorkerGlobalScope
export const isSharedWorker = (value: unknown): value is SharedWorker => !!globalThis.SharedWorker && value instanceof SharedWorker
export const isMessagePort = (value: unknown): value is MessagePort => value instanceof MessagePort
export const isPromise = (value: unknown): value is Promise<unknown> => value instanceof Promise
export const isFunction = (value: unknown): value is Function => typeof value === 'function'
export const isArrayBuffer = (value: unknown): value is ArrayBuffer => value instanceof ArrayBuffer
export const isReadableStream = (value: unknown): value is ReadableStream => value instanceof ReadableStream
export const isDate = (value: unknown): value is Date => value instanceof Date
export const isError = (value: unknown): value is Error => value instanceof Error

export const isOsraMessage = (value: unknown): value is Message =>
  !!value
  && typeof value === 'object'
  && OSRA_KEY in value
  && !!value[OSRA_KEY]

/** True if `value` is an instance of any of the given (possibly undefined-on-this-platform)
 *  constructors. Tolerates missing globals so callers don't have to guard each one. */
export const instanceOfAny = (value: unknown, ctors: readonly (Function | undefined)[]): boolean => {
  for (const ctor of ctors) if (ctor && value instanceof ctor) return true
  return false
}

export const isClonable = (value: unknown): boolean =>
  instanceOfAny(value, [globalThis.SharedArrayBuffer])

export const isTransferable = (value: unknown): value is Transferable =>
  instanceOfAny(value, [
    globalThis.ArrayBuffer,
    globalThis.MessagePort,
    globalThis.ReadableStream,
    globalThis.WritableStream,
    globalThis.TransformStream,
    globalThis.ImageBitmap,
  ])

export type WebExtRuntime = typeof browser.runtime
export const isWebExtensionRuntime = (value: unknown): value is WebExtRuntime => {
  const runtime = getWebExtensionRuntime()
  if (!runtime) return false
  return value === runtime
}

export type WebExtPort = ReturnType<WebExtRuntime['connect']> | Runtime.Port
export const isWebExtensionPort = (value: unknown, connectPort: boolean = false): value is WebExtPort => {
  if (!value || typeof value !== 'object') return false
  // Prevent SecurityError when `value` is a cross-origin window.
  if (isWindow(value)) return false
  if (!('name' in value) || !('disconnect' in value) || !('postMessage' in value)) return false
  // these properties are only present on WebExtPorts created through runtime.connect()
  if (!connectPort) return true
  return 'sender' in value && 'onMessage' in value && 'onDisconnect' in value
}

export type WebExtSender = NonNullable<WebExtPort['sender']>

// Structural guard shared by WebExtOnConnect and WebExtOnMessage — both expose
// the `addListener` / `hasListener` / `removeListener` trio and nothing else.
const hasListenerApi = (value: unknown): boolean =>
  !!value
  && typeof value === 'object'
  // Prevent SecurityError when `value` is a cross-origin window.
  && !isWindow(value)
  && 'addListener' in value
  && 'hasListener' in value
  && 'removeListener' in value

export type WebExtOnConnect = WebExtRuntime['onConnect']
export const isWebExtensionOnConnect = (value: unknown): value is WebExtOnConnect =>
  hasListenerApi(value)

export type WebExtOnMessage = WebExtRuntime['onMessage']
export const isWebExtensionOnMessage = (value: unknown): value is WebExtOnMessage =>
  hasListenerApi(value)

export const isWindow = (value: unknown): value is Window => {
  if (!value || typeof value !== 'object') return false
  try {
    return 'window' in value && value.window === value
  } catch {
    // Cross-origin Window access can throw SecurityError; fall back to a
    // no-read shape probe that tolerates protected properties.
    try {
      return 'closed' in value
        && typeof value.closed === 'boolean'
        && 'close' in value
        && typeof value.close === 'function'
    } catch {
      return false
    }
  }
}

export const isEmitJsonOnlyTransport = (value: unknown): value is EmitJsonPlatformTransport =>
     isWebSocket(value)
  || isWebExtensionPort(value)
  || isWebExtensionRuntime(value)

export const isReceiveJsonOnlyTransport = (value: unknown): value is ReceiveJsonPlatformTransport =>
     isWebSocket(value)
  || isWebExtensionPort(value)
  || isWebExtensionOnConnect(value)
  || isWebExtensionOnMessage(value)
  || isWebExtensionRuntime(value)

export type IsJsonOnlyTransport<T extends Transport> = T extends JsonPlatformTransport ? true : false
export const isJsonOnlyTransport = (value: unknown): value is Extract<Transport, JsonPlatformTransport> =>
     (!!value && typeof value === 'object' && 'isJson' in value && value.isJson === true)
  || isEmitJsonOnlyTransport(value)
  || isReceiveJsonOnlyTransport(value)

export const isEmitTransport = (value: unknown): value is EmitTransport =>
     isWindow(value)
  || isEmitJsonOnlyTransport(value)
  || isServiceWorkerContainer(value)
  || isWorker(value)
  || isDedicatedWorker(value)
  || isSharedWorker(value)
  || isMessagePort(value)
  || isCustomEmitTransport(value)

export function assertEmitTransport(transport: Transport): asserts transport is EmitTransport {
  if (!isEmitTransport(transport)) throw new Error('Transport is not emitable')
}

export const isReceiveTransport = (value: unknown): value is ReceiveTransport =>
     isWindow(value)
  || isReceiveJsonOnlyTransport(value)
  || isServiceWorkerContainer(value)
  || isWorker(value)
  || isDedicatedWorker(value)
  || isSharedWorker(value)
  || isMessagePort(value)
  || isCustomReceiveTransport(value)

export function assertReceiveTransport(transport: Transport): asserts transport is ReceiveTransport {
  if (!isReceiveTransport(transport)) throw new Error('Transport is not receiveable')
}

export const isCustomEmitTransport = (value: unknown): value is CustomEmitTransport => {
  if (!value || typeof value !== 'object') return false
  // Prevent SecurityError when `value` is a cross-origin window.
  if (isWindow(value)) return false
  if (!('emit' in value)) return false
  return isEmitTransport(value.emit) || typeof value.emit === 'function'
}

export const isCustomReceiveTransport = (value: unknown): value is CustomReceiveTransport => {
  if (!value || typeof value !== 'object') return false
  // Prevent SecurityError when `value` is a cross-origin window.
  if (isWindow(value)) return false
  if (!('receive' in value)) return false
  return isReceiveTransport(value.receive) || typeof value.receive === 'function'
}

export const isCustomTransport = (value: unknown): value is CustomTransport =>
     isCustomEmitTransport(value)
  || isCustomReceiveTransport(value)

export const isTransport = (value: unknown): value is Transport =>
     isEmitTransport(value)
  || isReceiveTransport(value)
  || isCustomTransport(value)
  || isJsonOnlyTransport(value)

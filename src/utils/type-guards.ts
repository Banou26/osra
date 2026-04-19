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

const typedArrayConstructorsByName = {
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
  BigUint64Array,
} as const

export type TypedArrayType = keyof typeof typedArrayConstructorsByName
export type TypedArrayConstructor = (typeof typedArrayConstructorsByName)[TypedArrayType]
export type TypedArray = InstanceType<TypedArrayConstructor>

const typedArrayConstructors = Object.values(typedArrayConstructorsByName)

export const typedArrayToType = (value: TypedArray): TypedArrayType => {
  const name = value.constructor.name as TypedArrayType
  if (!(name in typedArrayConstructorsByName)) throw new Error('Unknown typed array type')
  return name
}

export const typedArrayTypeToTypedArrayConstructor = (value: TypedArrayType): TypedArrayConstructor => {
  const ctor = typedArrayConstructorsByName[value]
  if (!ctor) throw new Error('Unknown typed array type')
  return ctor
}

export const isTypedArray = (value: unknown): value is TypedArray =>
  typedArrayConstructors.some(ctor => value instanceof ctor)
export const isWebSocket = (value: unknown): value is WebSocket => value instanceof WebSocket
export const isServiceWorkerContainer = (value: unknown): value is ServiceWorkerContainer => !!globalThis.ServiceWorkerContainer && value instanceof ServiceWorkerContainer
export const isWorker = (value: unknown): value is Worker => !!globalThis.Worker && value instanceof Worker
// @ts-expect-error DedicatedWorkerGlobalScope is only present in worker scopes
export const isDedicatedWorker = (value: unknown): value is DedicatedWorkerGlobalScope => !!globalThis.DedicatedWorkerGlobalScope && value instanceof DedicatedWorkerGlobalScope
export const isSharedWorker = (value: unknown): value is SharedWorker => !!globalThis.SharedWorker && value instanceof SharedWorker
const isMessagePort = (value: unknown): value is MessagePort => value instanceof MessagePort

export const isOsraMessage = (value: unknown): value is Message =>
  !!value
  && typeof value === 'object'
  && OSRA_KEY in value
  && !!value[OSRA_KEY]

type AnyConstructor = abstract new (...args: any[]) => unknown

/** True if `value` is an instance of any of the given (possibly undefined-on-this-platform)
 *  constructors. Tolerates missing globals so callers don't have to guard each one. */
export const instanceOfAny = (value: unknown, ctors: readonly (AnyConstructor | undefined)[]): boolean => {
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

// Structural guard for any `addListener` / `hasListener` / `removeListener` event.
// Not enough on its own to tell onConnect from onMessage — they have identical shapes.
const hasListenerApi = (value: unknown): boolean =>
  !!value
  && typeof value === 'object'
  // Prevent SecurityError when `value` is a cross-origin window.
  && !isWindow(value)
  && 'addListener' in value
  && 'hasListener' in value
  && 'removeListener' in value

// Identity-compare against the runtime's onConnect events: structural checks
// can't distinguish onConnect from onMessage, and misclassifying onMessage as
// onConnect makes us treat each incoming message as a port and crash on
// `message.onMessage.addListener`.
export type WebExtOnConnect = WebExtRuntime['onConnect']
export const isWebExtensionOnConnect = (value: unknown): value is WebExtOnConnect => {
  const runtime = getWebExtensionRuntime()
  if (!runtime) return false
  return value === runtime.onConnect || value === runtime.onConnectExternal
}

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

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

// Import revivable modules for type guards
import * as messagePort from './revivables/message-port'
import { defaultRevivables, findRevivableForValue } from './revivables'

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
// TypedArray Utilities (re-exported from typed-array module)
// ============================================================================

export type {
  TypedArray,
  TypedArrayConstructor,
  TypeArrayType
} from './revivables/typed-array'

export {
  typedArrayToType,
  typedArrayTypeToTypedArrayConstructor,
  is as isTypedArray
} from './revivables/typed-array'

// ============================================================================
// Basic Type Guards
// ============================================================================
export const isWebSocket = (value: any) => value instanceof WebSocket
export const isServiceWorkerContainer = (value: any): value is ServiceWorkerContainer => globalThis.ServiceWorkerContainer && value instanceof ServiceWorkerContainer
export const isWorker = (value: any): value is Worker => globalThis.Worker && value instanceof Worker
// @ts-expect-error
export const isDedicatedWorker = (value: any): value is DedicatedWorkerGlobalScope => globalThis.DedicatedWorkerGlobalScope && value instanceof DedicatedWorkerGlobalScope
export const isSharedWorker = (value: any): value is SharedWorker => globalThis.SharedWorker && value instanceof SharedWorker


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

// Re-export from revivables module
export { isTransferable, isClonable } from './revivables'

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
  || messagePort.is(value)
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
  || messagePort.is(value)
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

export const revivableBoxToType = (value: RevivableBox) => value.type

export const revivableToType = <T extends Revivable>(value: T): SourceToRevivableType<T> => {
  const module = findRevivableForValue(value, defaultRevivables)
  if (module) return module.type as SourceToRevivableType<T>
  throw new Error('Unknown revivable type')
}

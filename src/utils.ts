import type {
  OsraMessage,
  LocalTargetOrFunction,
  RemoteTargetOrFunction,
  StructuredCloneTransferableProxiableType
} from './types'

import { OSRA_MESSAGE_KEY, OSRA_MESSAGE_PROPERTY } from './types'

export const registerLocalTargetListeners = (
  { listener, local, key = OSRA_MESSAGE_KEY, unregisterSignal }:
  {
    listener: (message: OsraMessage) => Promise<void>
    local: LocalTargetOrFunction
    key?: string
    unregisterSignal?: AbortSignal
  }
) => {
  if (typeof local === 'function') {
    local(listener)
  } else if (isWebExtensionOnMessage(local)) {
    const _listener = (message: any) => {
      if (!checkOsraMessageKey(message, key)) return
      listener(message)
    }
    local.addListener(_listener)
    if (unregisterSignal) {
      unregisterSignal.addEventListener('abort', () =>
        local.removeListener(_listener)
      )
    }
  } else {
    const _listener = (event: MessageEvent<OsraMessage>) => {
      if (!checkOsraMessageKey(event.data, key)) return
      listener(event.data)
    }
    local.addEventListener('message', _listener as unknown as EventListener)
    if (unregisterSignal) {
      unregisterSignal.addEventListener('abort', () =>
        local.removeEventListener('message', _listener as unknown as EventListener)
      )
    }
  }
}

export const replaceRecursive = <
  T extends StructuredCloneTransferableProxiableType,
  T2 extends (value: any) => any
>(
  value: T,
  shouldReplace: (value: Parameters<T2>[0]) => boolean,
  replaceFunction: T2
) =>
  shouldReplace(value) ? replaceFunction(value)
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

type WebExtOnMessage = typeof browser.runtime.onMessage

export const getWebExtensionGlobal = () => globalThis.browser ?? globalThis.chrome

export const isWebExtensionOnMessage = (object: any): object is WebExtOnMessage =>
  Boolean(
    (object as WebExtOnMessage)
    && (object as WebExtOnMessage).addListener
    && (object as WebExtOnMessage).hasListener
    && (object as WebExtOnMessage).removeListener
    && getWebExtensionGlobal().runtime.id
  )

export const isOsraMessage = (message: any): message is OsraMessage =>
  Boolean(
    (message)
    && (message as OsraMessage)[OSRA_MESSAGE_PROPERTY]
    && (message as OsraMessage).key
  )

export const checkOsraMessageKey = (message: any, key: string): message is OsraMessage =>
  isOsraMessage(message)
  && message.key === key

import type {
  OsraMessage,
  LocalTargetOrFunction,
  StructuredCloneTransferableProxiable,
  MessagePortProxy,
  Proxy
} from './types'

import { OSRA_MESSAGE_KEY, OSRA_MESSAGE_PROPERTY, OSRA_PROXY } from './types'

export const registerLocalTargetListeners = (
  { listener, local, remoteName, key = OSRA_MESSAGE_KEY, unregisterSignal }:
  {
    listener: (message: OsraMessage) => Promise<void>
    local: LocalTargetOrFunction
    remoteName?: string
    key?: string
    unregisterSignal?: AbortSignal
  }
) => {
  if (typeof local === 'function') {
    local(listener)
  } else if (isWebExtensionOnMessage(local)) {
    const _listener = (message: any) => {
      if (!checkOsraMessageKey(message, key)) return
      if (remoteName && message.name !== remoteName) return
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
      if (remoteName && event.data.name !== remoteName) return
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

export type Context = {
  uuid: string
  remoteUUid: string
  remotes: Map<string, any>
}

const isProxy = (value: StructuredCloneTransferableProxiable): value is Proxy<boolean> =>
  Boolean(
    value
    && typeof value === 'object'
    && OSRA_PROXY in value
  )

const isMessagePortProxy = (value: StructuredCloneTransferableProxiable): value is MessagePortProxy<boolean> =>
  isProxy(value) && value.type === 'messagePort'
export const replaceMessagePort = (value: StructuredCloneTransferableProxiable, context: Context) => {

}

export const reviveMessagePort = (value: StructuredCloneTransferableProxiable, context: Context) => {

}

const isFunctionProxy = (value: StructuredCloneTransferableProxiable): value is FunctionProxy<boolean> =>
  isProxy(value) && value.type === 'function'

export const replaceFunction = (value: StructuredCloneTransferableProxiable, context: Context) => {

}

export const reviveFunction = (value: StructuredCloneTransferableProxiable, context: Context) => {

}

export const replaceAll = (value: StructuredCloneTransferableProxiable, context: Context) =>
  value instanceof MessagePort ? replaceMessagePort(value, context)
  : typeof value === 'function' ? replaceFunction(value, context)
  : value

export const reviveAll = (value: StructuredCloneTransferableProxiable, context: Context) =>
  value instanceof MessagePort ? reviveMessagePort(value, context)
  : typeof value === 'function' ? reviveFunction(value, context)
  : value

export const replaceRecursive = <
  T extends StructuredCloneTransferableProxiable
>(
  value: T,
  replace: (value: StructuredCloneTransferableProxiable) => StructuredCloneTransferableProxiable
): StructuredCloneTransferableProxiable => {
  const replacedValue = replace(value)

  return (
    Array.isArray(replacedValue) ? replacedValue.map(value => replaceRecursive(value, replace))
    : replacedValue && typeof replacedValue === 'object' ? (
      Object.fromEntries(
        Object
          .entries(replacedValue)
          .map(([key, value]: [string, StructuredCloneTransferableProxiable]) => [
            key,
            replaceRecursive(value, replace)
          ])
      )
    )
    : replacedValue
  )
}


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

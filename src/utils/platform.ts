import type { OsraMessage, LocalTargetOrFunction, RemoteTargetOrFunction } from '../types'

import { OSRA_MESSAGE_KEY, OSRA_MESSAGE_PROPERTY } from '../types'
import { isWebExtensionPort, isWebExtensionRuntime, isWindow, WebExtPort, WebExtSender } from './capabilities'

export const isOsraMessage = (message: any): message is OsraMessage =>
  Boolean(
    (message)
    && (message as OsraMessage)[OSRA_MESSAGE_PROPERTY]
    && (message as OsraMessage).key
  )

export const checkOsraMessageKey = (message: any, key: string): message is OsraMessage =>
  isOsraMessage(message)
  && message.key === key

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
  } else if (isWebExtensionPort(local) || isWebExtensionRuntime(local)) {
    const listenOnWebExtensionPort = (port: WebExtPort) => {
      const _listener = (message: object) => {
        if (!checkOsraMessageKey(message, key)) return
        if (remoteName && message.name !== remoteName) return
        listener(message)
      }
      port.onMessage.addListener(_listener)
      if (unregisterSignal) {
        unregisterSignal.addEventListener('abort', () =>
          port.onMessage.removeListener(_listener)
        )
      }
    }

    if (isWebExtensionRuntime(local)) {
      const _listener = (port: WebExtPort) => {
        listenOnWebExtensionPort(port)
      }
      local.onConnect.addListener(_listener)
      if (unregisterSignal) {
        unregisterSignal.addEventListener('abort', () =>
          local.onConnect.removeListener(_listener)
        )
      }
    } else {
      listenOnWebExtensionPort(local)
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

export const postOsraMessage = (
  target: RemoteTargetOrFunction,
  message: OsraMessage,
  origin = '*',
  transferables: Transferable[] = []
) => {
  if (typeof target === 'function') {
    target(message, transferables)
  } else if (isWebExtensionPort(target)) {
    target.postMessage(message)
  } else if (isWindow(target)) {
    target.postMessage(message, origin, transferables)
  } else {
    target.postMessage(message, transferables)
  }
}

import type { Message, LocalTargetOrFunction as Transport, RemoteTargetOrFunction, Transport } from '../types'

import { OSRA_KEY } from '../types'
import { isOsraMessage } from './type-guards'

export const getWebExtensionGlobal = () => globalThis.browser ?? globalThis.chrome
export const getWebExtensionRuntime = () => getWebExtensionGlobal().runtime

export const checkOsraMessageKey = (message: any, key: string): message is Message =>
  isOsraMessage(message)
  && message[OSRA_KEY] === key

export const registerOsraMessageListener = (
  { listener, local, remoteName, key = OSRA_KEY, unregisterSignal }:
  {
    listener: (message: Message) => Promise<void>
    local: Transport
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
    const _listener = (event: MessageEvent<Message>) => {
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

export const sendOsraMessage = (
  transport: Transport,
  message: Message,
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

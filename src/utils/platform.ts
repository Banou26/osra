import type {
  CustomTransport, EmitTransport,
  Message, MessageContext,
  ReceiveTransport
} from '../types'

import { OSRA_KEY } from '../types'
import {
  isOsraMessage, isCustomTransport,
  isWebExtensionOnConnect, isWebExtensionOnMessage,
  isWebExtensionPort, isWebSocket, WebExtOnMessage,
  WebExtPort, WebExtSender, isWindow, isSharedWorker
} from './type-guards'

export const getWebExtensionGlobal = () => globalThis.browser ?? globalThis.chrome
export const getWebExtensionRuntime = () => getWebExtensionGlobal().runtime

export const checkOsraMessageKey = (message: any, key: string): message is Message =>
  isOsraMessage(message)
  && message[OSRA_KEY] === key

export const registerOsraMessageListener = (
  { listener, transport, remoteName, key = OSRA_KEY, unregisterSignal }:
  {
    listener: (message: Message, messageContext: MessageContext) => Promise<void>
    transport: ReceiveTransport
    remoteName?: string
    key?: string
    unregisterSignal?: AbortSignal
  }
) => {
  const registerListenerOnReceiveTransport = (receiveTransport: Extract<CustomTransport, { receive: any }>['receive']) => {
    // Custom function handler
    if (typeof receiveTransport === 'function') {
      receiveTransport(listener)
      // WebExtension handler
    } else if (
      isWebExtensionPort(receiveTransport)
      || isWebExtensionOnConnect(receiveTransport)
      || isWebExtensionOnMessage(receiveTransport)
    ) {
      const listenOnWebExtOnMessage = (onMessage: WebExtOnMessage, port?: WebExtPort) => {
        const _listener = (message: object, sender?: WebExtSender) => {
          if (!checkOsraMessageKey(message, key)) return
          if (remoteName && message.name !== remoteName) return
          listener(message, { port, sender })
        }
        onMessage.addListener(_listener)
        if (unregisterSignal) {
          unregisterSignal.addEventListener('abort', () =>
            onMessage.removeListener(_listener)
          )
        }
      }

      // WebExtOnConnect
      if (isWebExtensionOnConnect(receiveTransport)) {
        const _listener = (port: WebExtPort) => {
          listenOnWebExtOnMessage(port.onMessage, port)
        }
        receiveTransport.addListener(_listener)
        if (unregisterSignal) {
          unregisterSignal.addEventListener('abort', () =>
            receiveTransport.removeListener(_listener)
          )
        }
      // WebExtOnMessage
      } else if (isWebExtensionOnMessage(receiveTransport)) {
        listenOnWebExtOnMessage(receiveTransport)
      } else { // WebExtPort
        listenOnWebExtOnMessage(receiveTransport.onMessage)
      }
    } else { // Window, Worker, WebSocket, ect...
      const _listener = (event: MessageEvent<Message>) => {
        if (!checkOsraMessageKey(event.data, key)) return
        if (remoteName && event.data.name !== remoteName) return
        listener(event.data, { receiveTransport, source: event.source })
      }
      receiveTransport.addEventListener('message', _listener as unknown as EventListener)
      if (unregisterSignal) {
        unregisterSignal.addEventListener('abort', () =>
          receiveTransport.removeEventListener('message', _listener as unknown as EventListener)
        )
      }
    }
  }
  if (isCustomTransport(transport)) {
    registerListenerOnReceiveTransport(transport.receive)
  } else {
    registerListenerOnReceiveTransport(transport)
  }
}

export const sendOsraMessage = (
  transport: EmitTransport,
  message: Message,
  origin = '*',
  transferables: Transferable[] = []
) => {
  const sendToEmitTransport = (emitTransport: Extract<EmitTransport, { emit: any }>['emit']) => {
    if (typeof emitTransport === 'function') {
      emitTransport(message, transferables)
    } else if (isWebExtensionPort(emitTransport)) {
      emitTransport.postMessage(message)
    } else if (isWindow(emitTransport)) {
      emitTransport.postMessage(message, origin, transferables)
    } else if (isWebSocket(emitTransport)) {
      emitTransport.send(JSON.stringify(message))
    } else if (isSharedWorker(emitTransport)) {
      emitTransport.port.postMessage(message, transferables)
    } else { // MessagePort | ServiceWorker | Worker
      emitTransport.postMessage(message, transferables)
    }
  }

  if (isCustomTransport(transport)) {
    sendToEmitTransport(transport.emit)
  } else {
    sendToEmitTransport(transport)
  }
}

import type { Message} from '../types'
import type {
  WebExtOnConnect, WebExtOnMessage,
  WebExtPort, WebExtRuntime, WebExtSender
} from './type-guards'

import { OSRA_KEY } from '../types'
import {
  isOsraMessage, isCustomTransport,
  isWebExtensionOnConnect, isWebExtensionOnMessage,
  isWebExtensionPort, isWebExtensionRuntime, isWebSocket, isWindow, isSharedWorker
} from './type-guards'

export type MessageContext = {
  port?: MessagePort | WebExtPort // WebExtension
  sender?: WebExtSender // WebExtension
  receiveTransport?: ReceivePlatformTransport
  source?: MessageEventSource | null // Window, Worker, WebSocket, ect...
}

export type ReceiveHandler = (listener: (event: Message, messageContext: MessageContext) => void) => void
export type EmitHandler = (message: Message, transferables?: Transferable[]) => void

type CustomReceive = ReceivePlatformTransport | ReceiveHandler
type CustomEmit = EmitPlatformTransport | EmitHandler

export type CustomTransport =
  { isJson?: boolean }
  & (
    | { receive: CustomReceive, emit: CustomEmit }
    | { receive: CustomReceive }
    | { emit: CustomEmit }
  )

export type CustomEmitTransport = Extract<CustomTransport, { emit: any }>
export type CustomReceiveTransport = Extract<CustomTransport, { receive: any }>

export type EmitJsonPlatformTransport =
  | WebSocket
  | WebExtPort
  | WebExtRuntime

export type ReceiveJsonPlatformTransport =
  | WebSocket
  | WebExtPort
  | WebExtOnConnect
  | WebExtOnMessage
  | WebExtRuntime

export type JsonPlatformTransport =
  | { isJson: true }
  | EmitJsonPlatformTransport
  | ReceiveJsonPlatformTransport

type StructuredClonePlatformTransport =
  | Window
  | ServiceWorker
  | Worker
  | SharedWorker
  | MessagePort

export type EmitPlatformTransport =
  | EmitJsonPlatformTransport
  | StructuredClonePlatformTransport

export type ReceivePlatformTransport =
  | ReceiveJsonPlatformTransport
  | StructuredClonePlatformTransport

export type PlatformTransport =
  | EmitPlatformTransport
  | ReceivePlatformTransport

export type EmitTransport = EmitPlatformTransport & Extract<CustomTransport, { emit: any }>
export type ReceiveTransport = ReceivePlatformTransport & Extract<CustomTransport, { receive: any }>

export type Transport =
  | PlatformTransport
  | CustomTransport

export const getWebExtensionGlobal = () => globalThis.browser ?? globalThis.chrome
export const getWebExtensionRuntime = () => getWebExtensionGlobal()?.runtime

export const checkOsraMessageKey = (message: any, key: string): message is Message =>
  isOsraMessage(message)
  && message[OSRA_KEY] === key

const onAbort = (signal: AbortSignal | undefined, fn: () => void) =>
  signal?.addEventListener('abort', fn, { once: true })

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
  const receiveTransport: Extract<CustomTransport, { receive: any }>['receive'] =
    isCustomTransport(transport) ? transport.receive : transport

  // Custom function handler
  if (typeof receiveTransport === 'function') {
    receiveTransport(listener)
    return
  }

  // WebExtension family — subscribe to an `onMessage`-style listener API.
  if (
    isWebExtensionRuntime(receiveTransport)
    || isWebExtensionPort(receiveTransport)
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
      onAbort(unregisterSignal, () => onMessage.removeListener(_listener))
    }

    if (isWebExtensionRuntime(receiveTransport)) {
      listenOnWebExtOnMessage(receiveTransport.onMessage)
    } else if (isWebExtensionOnConnect(receiveTransport)) {
      // Port.onMessage has a narrower (message, port) shape than the shared
      // (message, sender) Runtime.onMessage — but our listener only reads
      // `message` so the runtime shape covers both.
      const _listener = (port: WebExtPort) =>
        listenOnWebExtOnMessage(port.onMessage as WebExtOnMessage, port)
      receiveTransport.addListener(_listener)
      onAbort(unregisterSignal, () => receiveTransport.removeListener(_listener))
    } else if (isWebExtensionOnMessage(receiveTransport)) {
      listenOnWebExtOnMessage(receiveTransport)
    } else { // WebExtPort
      listenOnWebExtOnMessage(receiveTransport.onMessage as WebExtOnMessage)
    }
    return
  }

  // Window, Worker, WebSocket, ServiceWorker, MessagePort, …
  const messageListener = (event: MessageEvent<Message>) => {
    if (!checkOsraMessageKey(event.data, key)) return
    if (remoteName && event.data.name !== remoteName) return
    listener(event.data, { receiveTransport, source: event.source })
  }
  receiveTransport.addEventListener('message', messageListener as EventListener)
  onAbort(unregisterSignal, () =>
    receiveTransport.removeEventListener('message', messageListener as EventListener),
  )
}

export const sendOsraMessage = (
  transport: EmitTransport,
  message: Message,
  origin = '*',
  transferables: Transferable[] = []
) => {
  const emitTransport: Extract<EmitTransport, { emit: any }>['emit'] =
    isCustomTransport(transport) ? transport.emit : transport

  if (typeof emitTransport === 'function') {
    emitTransport(message, transferables)
  } else if (isWindow(emitTransport)) {
    // Must be checked first: cross-origin windows throw on other property access.
    emitTransport.postMessage(message, origin, transferables)
  } else if (isWebExtensionPort(emitTransport)) {
    emitTransport.postMessage(message)
  } else if (isWebExtensionRuntime(emitTransport)) {
    emitTransport.sendMessage(message)
  } else if (isWebSocket(emitTransport)) {
    emitTransport.send(JSON.stringify(message))
  } else if (isSharedWorker(emitTransport)) {
    emitTransport.port.postMessage(message, transferables)
  } else { // MessagePort | ServiceWorker | Worker
    emitTransport.postMessage(message, transferables)
  }
}

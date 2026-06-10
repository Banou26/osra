import type { Browser } from 'webextension-polyfill'
import type { Message} from '../types.js'
import type {
  WebExtOnConnect, WebExtOnMessage,
  WebExtPort, WebExtRuntime, WebExtSender
} from './type-guards.js'

import { OSRA_DEFAULT_KEY, OSRA_KEY } from '../types.js'
import {
  isOsraMessage, isCustomTransport,
  isWebExtensionOnConnect, isWebExtensionOnMessage,
  isWebExtensionPort, isWebExtensionRuntime, isWebSocket, isWindow, isSharedWorker
} from './type-guards.js'

export type MessageContext = {
  port?: MessagePort | WebExtPort // WebExtension
  sender?: WebExtSender // WebExtension
  receiveTransport?: ReceivePlatformTransport
  source?: MessageEventSource | null // Window, Worker, WebSocket, ect...
  origin?: string // Window
}

export type ReceiveHandler = (listener: (event: Message, messageContext: MessageContext) => void) => void | (() => void)
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

export type EmitPlatformTransport =
  | EmitJsonPlatformTransport
  | Window
  | ServiceWorker
  | Worker
  | SharedWorker
  | MessagePort

export type ReceivePlatformTransport =
  | ReceiveJsonPlatformTransport
  | Window
  | ServiceWorkerContainer
  | Worker
  | SharedWorker
  | MessagePort

export type PlatformTransport =
  | EmitPlatformTransport
  | ReceivePlatformTransport

export type EmitTransport = EmitPlatformTransport | CustomEmitTransport
export type ReceiveTransport = ReceivePlatformTransport | CustomReceiveTransport

export type Transport =
  | PlatformTransport
  | CustomTransport

// Typed via the shipped webextension-polyfill module types — referencing the
// ambient `browser`/`chrome` globals here would leak unresolvable names into
// the published .d.ts (those @types are devDependencies only).
type WebExtGlobals = { browser?: Browser, chrome?: Browser }
export const getWebExtensionGlobal = (): Browser | undefined =>
  (globalThis as unknown as WebExtGlobals).browser ?? (globalThis as unknown as WebExtGlobals).chrome
export const getWebExtensionRuntime = () => getWebExtensionGlobal()?.runtime

export const checkOsraMessageKey = (message: any, key: string): message is Message =>
  isOsraMessage(message)
  && message[OSRA_KEY] === key

const onAbort = (signal: AbortSignal | undefined, fn: () => void) => {
  if (!signal) return
  if (signal.aborted) {
    fn()
    return
  }
  signal.addEventListener('abort', fn, { once: true })
}

export const registerOsraMessageListener = (
  { listener, transport, remoteName, key = OSRA_DEFAULT_KEY, origin = '*', unregisterSignal }:
  {
    listener: (message: Message, messageContext: MessageContext) => void
    transport: ReceiveTransport
    remoteName?: string
    key?: string
    origin?: string
    unregisterSignal?: AbortSignal
  }
) => {
  if (unregisterSignal?.aborted) return

  const receiveTransport: Extract<CustomTransport, { receive: any }>['receive'] =
    isCustomTransport(transport) ? transport.receive : transport

  // Custom function handler
  if (typeof receiveTransport === 'function') {
    const unregister = receiveTransport((message, ctx) => {
      if (unregisterSignal?.aborted) return
      if (!checkOsraMessageKey(message, key)) return
      if (remoteName && message.name !== remoteName) return
      listener(message, ctx)
    })
    if (typeof unregister === 'function') onAbort(unregisterSignal, unregister)
    return
  }

  // WebExtension family — subscribe to an `onMessage`-style listener.
  if (
    isWebExtensionRuntime(receiveTransport)
    || isWebExtensionPort(receiveTransport)
    || isWebExtensionOnConnect(receiveTransport)
    || isWebExtensionOnMessage(receiveTransport)
  ) {
    const listenOnWebExtOnMessage = (onMessage: WebExtOnMessage, port?: WebExtPort) => {
      const _listener = (message: unknown, sender?: WebExtSender) => {
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

  // Window, Worker, WebSocket, ServiceWorkerContainer, MessagePort, SharedWorker, …
  // SharedWorker dispatches messages on its .port, not on the worker object.
  const target = isSharedWorker(receiveTransport) ? receiveTransport.port : receiveTransport
  // Inbound origin filtering is a cross-origin *window* concern — WebSocket
  // and ServiceWorkerContainer events carry their own unrelated origins and
  // a page-origin value would silently drop all their traffic.
  const filterByOrigin = origin !== '*' && isWindow(receiveTransport)
  const messageListener = (event: MessageEvent<Message | string>) => {
    // JSON transports (WebSocket) deliver strings — parse before the key check.
    let data = event.data
    if (typeof data === 'string') {
      try { data = JSON.parse(data) as Message } catch { return }
    }
    if (!checkOsraMessageKey(data, key)) return
    if (remoteName && data.name !== remoteName) return
    if (filterByOrigin && event.origin && event.origin !== origin) return
    listener(data, { receiveTransport, source: event.source, origin: event.origin })
  }
  target.addEventListener('message', messageListener as EventListener)
  // addEventListener alone never enables a MessagePort's queue — only
  // .start() or assigning onmessage does.
  if (target instanceof MessagePort) target.start()
  onAbort(unregisterSignal, () =>
    target.removeEventListener('message', messageListener as EventListener),
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
    // Must check first — cross-origin windows throw on other property access.
    emitTransport.postMessage(message, origin, transferables)
  } else if (isWebExtensionPort(emitTransport)) {
    emitTransport.postMessage(message)
  } else if (isWebExtensionRuntime(emitTransport)) {
    emitTransport.sendMessage(message)
  } else if (isWebSocket(emitTransport)) {
    const payload = JSON.stringify(message)
    if (emitTransport.readyState === WebSocket.CONNECTING) {
      emitTransport.addEventListener('open', () => emitTransport.send(payload), { once: true })
    } else {
      emitTransport.send(payload)
    }
  } else if (isSharedWorker(emitTransport)) {
    emitTransport.port.postMessage(message, transferables)
  } else { // MessagePort | ServiceWorker | Worker
    emitTransport.postMessage(message, transferables)
  }
}
